import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DocumentRejectedError,
  type ExtractedLine,
  type ExtractionIssue,
  type RawExtraction,
} from './extraction-types';

/**
 * Reads the text layer of a PDF with Mozilla's PDF.js, in a locked-down configuration:
 * no JavaScript evaluation, no fonts loaded into the system, nothing rendered.
 * Scanned PDFs (pictures of pages) have no text layer; they are reported, not guessed.
 */

export const PDF_MAX_PAGES = 500;
/** A document that takes longer than this to read is refused (protects the server). */
export const PDF_MAX_EXTRACTION_MS = 60_000;
/** More text than this is not a constitution; refusing it bounds memory use. */
export const PDF_MAX_TEXT_CHARACTERS = 3_000_000;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface PdfJs {
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
}
interface PdfDocument {
  numPages: number;
  getPage(
    page: number,
  ): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
}

// PDF.js is published as an ES module. In the compiled API (CommonJS), import() becomes require(),
// which Node 22 supports for ES modules; test runners keep it as a real import(). The specifier is a
// plain string variable so TypeScript does not look for type declarations of the .mjs file.
const PDFJS_ENTRY = String('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<{ pdfjs: PdfJs; standardFontDataUrl: string | undefined }> | undefined;

/**
 * PDF.js creates a DOMMatrix when it loads (it is used for drawing pages, which we never do).
 * Node has no DOMMatrix, so a minimal stand-in is provided instead of a native canvas library.
 */
function provideDrawingStubs(): void {
  const scope = globalThis as Record<string, unknown>;
  if (typeof scope.DOMMatrix === 'undefined') {
    scope.DOMMatrix = class DOMMatrixStub {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(init?: number[]) {
        if (Array.isArray(init) && init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as [
            number,
            number,
            number,
            number,
            number,
            number,
          ];
        }
      }
    };
  }
}

function loadPdfJs() {
  pdfjsPromise ??= (async () => {
    provideDrawingStubs();
    const pdfjs = (await import(PDFJS_ENTRY)) as PdfJs;
    // Where PDF.js keeps the data for the 14 standard PDF fonts (Helvetica, Times, ...).
    let standardFontDataUrl: string | undefined;
    try {
      const resolver =
        typeof require === 'function'
          ? require
          : createRequire(path.join(process.cwd(), 'index.js'));
      const entry = resolver.resolve(PDFJS_ENTRY);
      standardFontDataUrl = `${path.join(path.resolve(path.dirname(entry), '..', '..', '..'), 'standard_fonts')}${path.sep}`;
    } catch {
      standardFontDataUrl = undefined; // text can still be read without it
    }
    return { pdfjs, standardFontDataUrl };
  })();
  return pdfjsPromise;
}

/** Groups text pieces into lines by their vertical position, then left to right. */
export function itemsToLines(items: TextItem[]): { text: string; size: number }[] {
  const pieces = items
    .filter((item) => typeof item.str === 'string' && item.str.length > 0)
    .map((item) => ({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
      size: Math.abs(item.transform[3] ?? item.height ?? 0) || item.height || 0,
    }));
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; parts: typeof pieces }[] = [];
  for (const piece of pieces) {
    const tolerance = Math.max(2, piece.size * 0.4);
    const line = lines.find((candidate) => Math.abs(candidate.y - piece.y) <= tolerance);
    if (line) {
      line.parts.push(piece);
      line.size = Math.max(line.size, piece.size);
    } else {
      lines.push({ y: piece.y, size: piece.size, parts: [piece] });
    }
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let end = Number.NEGATIVE_INFINITY;
      for (const part of line.parts) {
        const gap = part.x - end;
        if (text && gap > line.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(part.text)) {
          text += ' ';
        }
        text += part.text;
        end = part.x + part.width;
      }
      return { text: text.replace(/\s+/g, ' ').trim(), size: line.size };
    })
    .filter((line) => line.text.length > 0);
}

export async function extractPdf(content: Buffer): Promise<RawExtraction> {
  const { pdfjs, standardFontDataUrl } = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(content),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
    standardFontDataUrl,
  });
  let document: PdfDocument;
  try {
    document = await task.promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new DocumentRejectedError(
        'password_protected',
        'The PDF is password-protected. Please upload a copy without a password.',
      );
    }
    throw new DocumentRejectedError(
      'invalid_pdf',
      'The PDF could not be opened. It may be damaged.',
    );
  }

  try {
    if (document.numPages > PDF_MAX_PAGES) {
      throw new DocumentRejectedError(
        'too_many_pages',
        `The PDF has ${document.numPages} pages. The limit is ${PDF_MAX_PAGES}.`,
      );
    }
    const issues: ExtractionIssue[] = [];
    const pages: { page: number; lines: { text: string; size: number }[] }[] = [];
    const startedAt = Date.now();
    let characters = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      if (Date.now() - startedAt > PDF_MAX_EXTRACTION_MS) {
        throw new DocumentRejectedError(
          'too_slow',
          'The PDF took too long to read. Please save it again (for example "Print to PDF") and upload that copy.',
        );
      }
      const page = await document.getPage(number);
      const textContent = await page.getTextContent();
      const lines = itemsToLines(textContent.items as TextItem[]);
      characters += lines.reduce((total, line) => total + line.text.length, 0);
      if (characters > PDF_MAX_TEXT_CHARACTERS) {
        throw new DocumentRejectedError(
          'too_much_text',
          'The PDF contains far more text than a constitution. Please check that it is the right file.',
        );
      }
      pages.push({ page: number, lines });
      page.cleanup();
    }

    const pagesWithText = pages.filter((page) => page.lines.length > 0);
    if (pagesWithText.length > 0) {
      for (const page of pages) {
        if (page.lines.length === 0) {
          issues.push({
            code: 'page_without_text',
            severity: 'warning',
            page: page.page,
            message: `Page ${page.page} has no readable text. It may be a scanned picture; its content is missing.`,
          });
        }
      }
    }

    // Repeated headers/footers (the same short line on most pages) and bare page numbers are dropped.
    const counts = new Map<string, number>();
    for (const page of pages) {
      for (const text of new Set(page.lines.map((line) => line.text))) {
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }
    const repeated = (text: string) =>
      pages.length >= 3 &&
      text.length <= 80 &&
      (counts.get(text) ?? 0) >= Math.ceil(pages.length * 0.6);
    const pageNumber = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

    const sizes = pages
      .flatMap((page) => page.lines.map((line) => line.size))
      .sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;

    const lines: ExtractedLine[] = [];
    for (const page of pages) {
      for (const line of page.lines) {
        if (pageNumber.test(line.text) || repeated(line.text)) continue;
        lines.push({
          text: line.text,
          page: page.page,
          headingLevel: median > 0 && line.size >= median * 1.25 ? 1 : undefined,
        });
      }
    }
    return { format: 'pdf', lines, pageCount: document.numPages, issues };
  } finally {
    // Frees the document and its worker (PDF.js 6 closes documents through the loading task).
    await task.destroy();
  }
}
