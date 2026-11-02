// Builds small, fictional PDF and DOCX files for tests and local development.
// No libraries: the formats are written by hand so the tests do not depend on test files on disk.
import { deflateRawSync } from 'node:zlib';

// ----- PDF ------------------------------------------------------------------------------------

export interface SamplePdfLine {
  text: string;
  /** Font size in points (default 11). Larger text looks like a heading to the extractor. */
  size?: number;
}

/** Escapes text for a PDF string literal. Only plain ASCII is used in samples. */
function pdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * A simple text PDF using the built-in Helvetica font. Each inner array is one page.
 * An empty page has no text at all (like a scanned image page).
 */
export function makeSamplePdf(pages: SamplePdfLine[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const pageIds: number[] = [];
  for (const lines of pages) {
    let y = 800;
    const commands = lines
      .map((line) => {
        const size = line.size ?? 11;
        y -= size + 8;
        return `BT /F1 ${size} Tf 56 ${y} Td (${pdfString(line.text)}) Tj ET`;
      })
      .join('\n');
    const contentId = add(
      `<< /Length ${Buffer.byteLength(commands, 'latin1')} >>\nstream\n${commands}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let output = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

// ----- ZIP (for DOCX) -------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes a ZIP archive (deflate-compressed entries). */
export function makeZip(entries: { name: string; content: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(data);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

// ----- DOCX -----------------------------------------------------------------------------------

export interface SampleDocxParagraph {
  text: string;
  /** Word style, e.g. "Heading1" or "Title". */
  style?: string;
  /** Automatic Word numbering: level 0 = "1.", level 1 = "(a)". */
  numbered?: 0 | 1;
}

function xmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word document with optional heading styles, automatic numbering and tracked changes. */
export function makeSampleDocx(
  paragraphs: SampleDocxParagraph[],
  options: { macroEnabled?: boolean; trackedInsertion?: string } = {},
): Buffer {
  const body = paragraphs
    .map((paragraph) => {
      const properties = [
        paragraph.style ? `<w:pStyle w:val="${paragraph.style}"/>` : '',
        paragraph.numbered !== undefined
          ? `<w:numPr><w:ilvl w:val="${paragraph.numbered}"/><w:numId w:val="1"/></w:numPr>`
          : '',
      ].join('');
      return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xmlText(paragraph.text)}</w:t></w:r></w:p>`;
    })
    .join('');
  const tracked = options.trackedInsertion
    ? `<w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>${xmlText(options.trackedInsertion)}</w:t></w:r></w:ins><w:del w:id="2" w:author="Reviewer"><w:r><w:delText>removed words</w:delText></w:r></w:del></w:p>`
    : '';
  const contentType = options.macroEnabled
    ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  return makeZip([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${contentType}"/></Types>`,
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}${tracked}</w:body></w:document>`,
    },
    {
      name: 'word/styles.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>` +
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>' +
        '</w:styles>',
    },
    {
      name: 'word/numbering.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>` +
        '<w:abstractNum w:abstractNumId="0">' +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' +
        '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/></w:lvl>' +
        '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    },
  ]);
}

// ----- A fictional constitution used for uploads in tests and the seed ------------------------

/** A short constitution with parts, numbered clauses and lettered sub-clauses. */
export function sampleConstitutionLines(name: string): string[] {
  return [
    `CONSTITUTION OF ${name.toUpperCase()}`,
    'PART 1 - GENERAL',
    '1. Name',
    `The organisation is called ${name}.`,
    '2. Objectives',
    'The objectives of the organisation are:',
    '(a) to serve its members;',
    '(b) to keep proper records.',
    'PART 2 - MEETINGS',
    '3. Annual general meeting',
    'An annual general meeting is held every year with 21 days notice.',
    '4. Quorum. The quorum for a general meeting is one third of members.',
  ];
}
