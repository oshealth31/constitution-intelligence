import {
  DocumentRejectedError,
  type ExtractedLine,
  type ExtractionIssue,
  type RawExtraction,
} from './extraction-types';
import { ZipArchive, ZipError } from './zip';

/**
 * Reads the text of a Word (.docx) document: paragraphs in order, heading styles, and the
 * numbers Word adds automatically ("1.", "(a)"). Macros, embedded objects and images are never
 * run or opened. Text inside deleted tracked changes is left out.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x')) return safeCodePoint(Number.parseInt(entity.slice(2), 16), whole);
    if (entity.startsWith('#')) return safeCodePoint(Number.parseInt(entity.slice(1), 10), whole);
    return ENTITIES[entity] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

function attribute(xml: string, tag: string, name = 'w:val'): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(xml);
  return match?.[1];
}

interface Level {
  start: number;
  format: string;
  text: string;
}

/** Word's numbering definitions: numId → levels. */
function readNumbering(xml: string | null): Map<string, Level[]> {
  const result = new Map<string, Level[]>();
  if (!xml) return result;
  const abstracts = new Map<string, Level[]>();
  for (const match of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels: Level[] = [];
    for (const lvl of match[2]!.matchAll(/<w:lvl\b[^>]*w:ilvl="(\d)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      levels[Number(lvl[1])] = {
        start: Number(attribute(lvl[2]!, 'w:start') ?? '1') || 1,
        format: attribute(lvl[2]!, 'w:numFmt') ?? 'decimal',
        text: decodeXml(attribute(lvl[2]!, 'w:lvlText') ?? ''),
      };
    }
    abstracts.set(match[1]!, levels);
  }
  for (const match of xml.matchAll(/<w:num\b[^>]*w:numId="([^"]+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abstractId = attribute(match[2]!, 'w:abstractNumId');
    const levels = abstractId ? abstracts.get(abstractId) : undefined;
    if (levels) result.set(match[1]!, levels);
  }
  return result;
}

function roman(value: number): string {
  const numerals: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let rest = value;
  let output = '';
  for (const [amount, symbol] of numerals) {
    while (rest >= amount) {
      output += symbol;
      rest -= amount;
    }
  }
  return output;
}

function letters(value: number): string {
  let rest = value;
  let output = '';
  while (rest > 0) {
    rest -= 1;
    output = String.fromCharCode(97 + (rest % 26)) + output;
    rest = Math.floor(rest / 26);
  }
  return output;
}

export function formatNumber(value: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return letters(value);
    case 'upperLetter':
      return letters(value).toUpperCase();
    case 'lowerRoman':
      return roman(value);
    case 'upperRoman':
      return roman(value).toUpperCase();
    case 'bullet':
    case 'none':
      return '';
    default:
      return String(value);
  }
}

interface StyleInfo {
  headingLevel?: number;
  numId?: string;
  ilvl?: number;
}

/** Paragraph styles: which are headings (and their level), and any numbering they carry. */
function readStyles(xml: string | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  for (const match of xml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const id = match[1]!;
    const body = match[2]!;
    const name = (attribute(body, 'w:name') ?? '').toLowerCase();
    const outline = attribute(body, 'w:outlineLvl');
    let headingLevel: number | undefined;
    if (name === 'title' || id.toLowerCase() === 'title') headingLevel = 0;
    else if (outline !== undefined) headingLevel = Number(outline) + 1;
    else {
      const heading = /^heading\s*(\d)$/.exec(name) ?? /^heading(\d)$/i.exec(id);
      if (heading) headingLevel = Number(heading[1]);
    }
    const numId = attribute(body, 'w:numId');
    const ilvl = attribute(body, 'w:ilvl');
    styles.set(id, { headingLevel, numId, ilvl: ilvl ? Number(ilvl) : undefined });
  }
  return styles;
}

export function extractDocx(content: Buffer): RawExtraction {
  let archive: ZipArchive;
  try {
    archive = new ZipArchive(content);
  } catch (error) {
    throw new DocumentRejectedError(
      'invalid_docx',
      error instanceof ZipError ? error.message : 'The file is not a valid Word document.',
    );
  }
  const contentTypes = archive.readText('[Content_Types].xml');
  const documentXml = archive.readText('word/document.xml');
  if (!contentTypes || !documentXml) {
    throw new DocumentRejectedError('invalid_docx', 'The file is not a valid Word document.');
  }
  if (/macroEnabled/i.test(contentTypes) || archive.has('word/vbaProject.bin')) {
    throw new DocumentRejectedError(
      'macros_not_allowed',
      'Word documents with macros (.docm) are not accepted. Please save the document as a normal .docx file.',
    );
  }

  const styles = readStyles(archive.readText('word/styles.xml'));
  const numbering = readNumbering(archive.readText('word/numbering.xml'));
  const counters = new Map<string, number[]>();
  const issues: ExtractionIssue[] = [];
  const lines: ExtractedLine[] = [];

  if (/<w:(ins|del)\b/.test(documentXml)) {
    issues.push({
      code: 'tracked_changes',
      severity: 'warning',
      message:
        'The Word document contains tracked changes. Insertions are included and deletions are left out. Please check the wording against the original.',
    });
  }

  for (const match of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const paragraph = match[1]!;
    const properties = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? '';
    const style = styles.get(attribute(properties, 'w:pStyle') ?? '');
    const outline = attribute(properties, 'w:outlineLvl');
    const headingLevel = outline !== undefined ? Number(outline) + 1 : style?.headingLevel;

    const text = decodeXml(
      paragraph
        .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, '')
        .replace(/<w:(tab|br|cr)\b[^>]*\/>/g, ' ')
        .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
        .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
        .match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)
        ?.map((run) => run.replace(/<[^>]+>/g, ''))
        .join('') ?? '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    let autoNumber: string | undefined;
    const numId = attribute(properties, 'w:numId') ?? style?.numId;
    const ilvlText = attribute(properties, 'w:ilvl');
    const ilvl = ilvlText !== undefined ? Number(ilvlText) : (style?.ilvl ?? 0);
    const levels = numId ? numbering.get(numId) : undefined;
    if (numId && levels && levels[ilvl]) {
      const current = counters.get(numId) ?? [];
      for (let level = 0; level <= ilvl; level += 1) {
        if (current[level] === undefined) current[level] = (levels[level]?.start ?? 1) - (level === ilvl ? 1 : 0);
      }
      current[ilvl] = (current[ilvl] ?? 0) + 1;
      current.length = ilvl + 1; // deeper levels restart
      counters.set(numId, current);
      const format = levels[ilvl]!;
      if (format.format !== 'bullet' && format.format !== 'none') {
        autoNumber = format.text
          .replace(/%(\d)/g, (_whole, digit: string) => {
            const level = Number(digit) - 1;
            return formatNumber(current[level] ?? levels[level]?.start ?? 1, levels[level]?.format ?? 'decimal');
          })
          .trim();
      }
    }
    lines.push({ text, headingLevel, autoNumber: autoNumber || undefined });
  }

  return { format: 'docx', lines, pageCount: null, issues };
}
