import { describe, expect, it } from 'vitest';
import {
  makeSampleDocx,
  makeSamplePdf,
  makeZip,
  sampleConstitutionLines,
} from '../../dev/sample-documents';
import { cleanFileName, validateDocument } from './document-validation';
import { extractDocx, formatNumber } from './docx-extractor';
import { DocumentRejectedError } from './extraction-types';
import { extractPdf, itemsToLines } from './pdf-extractor';
import { parseStructure } from './structure-parser';
import { ZipArchive } from './zip';

const MB = 1024 * 1024;

function rejection(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentRejectedError) return error.code;
    throw error;
  }
  return 'accepted';
}

describe('file validation', () => {
  const pdf = makeSamplePdf([[{ text: '1. Name' }]]);
  const docx = makeSampleDocx([{ text: 'Name', numbered: 0 }]);

  it('accepts real PDF and Word files', () => {
    expect(validateDocument('constitution.pdf', pdf, MB).format).toBe('pdf');
    expect(validateDocument('Constitution 2024.DOCX', docx, MB).format).toBe('docx');
  });

  it('refuses other file types, whatever their contents', () => {
    expect(rejection(() => validateDocument('notes.txt', pdf, MB))).toBe('unsupported_type');
    expect(rejection(() => validateDocument('old.doc', docx, MB))).toBe('unsupported_type');
    expect(rejection(() => validateDocument('macro.docm', docx, MB))).toBe('unsupported_type');
    expect(rejection(() => validateDocument('picture.svg', pdf, MB))).toBe('unsupported_type');
  });

  it('refuses files whose contents do not match their name', () => {
    expect(rejection(() => validateDocument('fake.pdf', docx, MB))).toBe('type_mismatch');
    expect(rejection(() => validateDocument('fake.docx', pdf, MB))).toBe('type_mismatch');
    expect(rejection(() => validateDocument('page.pdf', Buffer.from('<html>hi</html>'), MB))).toBe(
      'type_mismatch',
    );
  });

  it('refuses empty and oversized files', () => {
    expect(rejection(() => validateDocument('empty.pdf', Buffer.alloc(0), MB))).toBe('empty_file');
    expect(
      rejection(() => validateDocument('big.pdf', Buffer.concat([pdf, Buffer.alloc(2048)]), 1024)),
    ).toBe('too_large');
  });

  it('refuses PDFs that contain scripts or launch actions', () => {
    const scripted = Buffer.from(
      pdf
        .toString('latin1')
        .replace(
          '/Type /Catalog',
          '/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
        ),
      'latin1',
    );
    expect(rejection(() => validateDocument('scripted.pdf', scripted, MB))).toBe('active_content');
  });

  it('cleans file names', () => {
    expect(cleanFileName('C:\\Users\\me\\My <Constitution>.pdf')).toBe('My _Constitution_.pdf');
    expect(cleanFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(cleanFileName('')).toBe('document');
  });
});

describe('Word documents', () => {
  it('reads paragraphs, heading styles and automatic numbering', () => {
    const result = extractDocx(
      makeSampleDocx([
        { text: 'Constitution of the Sample Club', style: 'Title' },
        { text: 'General', style: 'Heading1' },
        { text: 'Name', numbered: 0 },
        { text: 'The club is called Sample Club & Friends.' },
        { text: 'Objectives', numbered: 0 },
        { text: 'to play', numbered: 1 },
        { text: 'to learn', numbered: 1 },
        { text: 'Meetings', numbered: 0 },
      ]),
    );
    expect(result.lines.map((line) => [line.autoNumber ?? '', line.text])).toEqual([
      ['', 'Constitution of the Sample Club'],
      ['', 'General'],
      ['1.', 'Name'],
      ['', 'The club is called Sample Club & Friends.'],
      ['2.', 'Objectives'],
      ['(a)', 'to play'],
      ['(b)', 'to learn'],
      ['3.', 'Meetings'],
    ]);
    expect(result.lines[0]!.headingLevel).toBe(0);
    expect(result.lines[1]!.headingLevel).toBe(1);
  });

  it('warns about tracked changes and leaves deleted text out', () => {
    const result = extractDocx(
      makeSampleDocx([{ text: 'Rules' }], { trackedInsertion: 'new words' }),
    );
    expect(result.issues.map((issue) => issue.code)).toContain('tracked_changes');
    expect(result.lines.map((line) => line.text)).toContain('new words');
    expect(JSON.stringify(result.lines)).not.toContain('removed words');
  });

  it('refuses macro-enabled and broken Word files', () => {
    expect(
      rejection(() => extractDocx(makeSampleDocx([{ text: 'x' }], { macroEnabled: true }))),
    ).toBe('macros_not_allowed');
    expect(rejection(() => extractDocx(makeZip([{ name: 'hello.txt', content: 'hi' }])))).toBe(
      'invalid_docx',
    );
    expect(rejection(() => extractDocx(Buffer.from('PK\u0003\u0004 not really a zip')))).toBe(
      'invalid_docx',
    );
  });

  it('refuses archives that would expand to an unreasonable size', () => {
    const bomb = makeZip([{ name: 'word/document.xml', content: Buffer.alloc(2 * MB) }]);
    expect(
      () =>
        new ZipArchive(bomb, {
          maxEntries: 10,
          maxTotalUncompressedBytes: MB,
          maxEntryUncompressedBytes: MB,
        }),
    ).toThrow(/too large|unreasonable/);
  });

  it('formats Word numbering styles', () => {
    expect(formatNumber(4, 'lowerRoman')).toBe('iv');
    expect(formatNumber(28, 'lowerLetter')).toBe('ab');
    expect(formatNumber(3, 'upperLetter')).toBe('C');
    expect(formatNumber(7, 'decimal')).toBe('7');
  });
});

describe('PDF documents', () => {
  it('reads text lines in order, page by page', async () => {
    const lines = sampleConstitutionLines('Test Club');
    const result = await extractPdf(
      makeSamplePdf([
        lines.slice(0, 6).map((text) => ({ text })),
        lines.slice(6).map((text) => ({ text })),
      ]),
    );
    expect(result.pageCount).toBe(2);
    expect(result.lines.map((line) => line.text)).toEqual(lines);
    expect(result.lines[6]!.page).toBe(2);
  });

  it('reports pages without text (for example scanned pages)', async () => {
    const result = await extractPdf(makeSamplePdf([[{ text: '1. Name' }, { text: 'Text.' }], []]));
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'page_without_text', page: 2 }),
    ]);
  });

  it('refuses damaged PDFs', async () => {
    await expect(extractPdf(Buffer.from('%PDF-1.4\nnot really a pdf'))).rejects.toMatchObject({
      code: 'invalid_pdf',
    });
  });

  it('joins pieces of text on the same line', () => {
    const item = (str: string, x: number, y: number, width: number) => ({
      str,
      transform: [11, 0, 0, 11, x, y],
      width,
      height: 11,
    });
    expect(
      itemsToLines([
        item('Quorum', 100, 700, 40),
        item('1.', 56, 700, 10),
        item('Next line', 56, 680, 50),
      ]),
    ).toEqual([
      { text: '1. Quorum', size: 11 },
      { text: 'Next line', size: 11 },
    ]);
  });
});

describe('structure detection', () => {
  const asLines = (texts: string[]) => texts.map((text) => ({ text, page: 1 }));

  it('finds parts, numbered clauses, headings and lettered sub-clauses', () => {
    const result = parseStructure(asLines(sampleConstitutionLines('Test Club')));
    expect(result.title).toBe('CONSTITUTION OF TEST CLUB');
    expect(result.sections.map((s) => [s.kind, s.number, s.heading, s.parentKey])).toEqual([
      ['part', 'Part 1', 'GENERAL', null],
      ['clause', '1', 'Name', 'part-1'],
      ['clause', '2', 'Objectives', 'part-1'],
      ['subclause', '(a)', null, 'c-2'],
      ['subclause', '(b)', null, 'c-2'],
      ['part', 'Part 2', 'MEETINGS', null],
      ['clause', '3', 'Annual general meeting', 'part-2'],
      ['clause', '4', 'Quorum', 'part-2'],
    ]);
    expect(result.sections.find((s) => s.number === '4')!.body).toBe(
      'The quorum for a general meeting is one third of members.',
    );
    expect(result.sections.every((s) => !s.needsReview)).toBe(true);
  });

  it('flags gaps, repeats and out-of-order numbering for a person to check', () => {
    const result = parseStructure(
      asLines([
        '1. Name',
        'Text.',
        '2. Rules',
        '(a) one;',
        '(c) three;',
        '4. Money',
        'Text.',
        '4. Again',
        'Text.',
        '3. Late',
        'Text.',
      ]),
    );
    const flagged = Object.fromEntries(
      result.sections.filter((s) => s.needsReview).map((s) => [s.number, s.reviewReason]),
    );
    expect(Object.keys(flagged).sort()).toEqual(['(c)', '3', '4'].sort());
    expect(flagged['(c)']).toMatch(/follows \(a\)/);
    expect(result.issues.map((issue) => issue.code)).toContain('sections_flagged');
  });

  it('places decimal sub-clauses under their clause and roman items under letters', () => {
    const result = parseStructure(
      asLines([
        '5. Finance',
        'Rules:',
        '5.1 The Treasurer keeps the books.',
        '5.2 Accounts:',
        '(a) are audited;',
        '(i) yearly;',
        '(ii) openly.',
      ]),
    );
    const byNumber = Object.fromEntries(result.sections.map((s) => [s.number, s]));
    expect(byNumber['5.1']!.parentKey).toBe(byNumber['5']!.key);
    expect(byNumber['(a)']!.parentKey).toBe(byNumber['5.2']!.key);
    expect(byNumber['(i)']!.parentKey).toBe(byNumber['(a)']!.key);
    expect(byNumber['(ii)']!.parentKey).toBe(byNumber['(a)']!.key);
  });

  it('does not mistake a sentence starting with a year for a clause', () => {
    const result = parseStructure(
      asLines([
        '1. History',
        'The club was founded in',
        '2026 members attended the first meeting.',
      ]),
    );
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.body).toContain('2026 members');
  });

  it('flags unreadable characters', () => {
    const result = parseStructure(
      asLines(['1. Name', 'The club is called \uFFFD\uFFFD\uFFFD (cid:12)(cid:13).']),
    );
    expect(result.sections[0]!.needsReview).toBe(true);
    expect(result.sections[0]!.reviewReason).toMatch(/could not be read/);
  });

  it('reports documents without text or without recognisable structure', () => {
    expect(parseStructure([]).issues).toEqual([
      expect.objectContaining({ code: 'no_text', severity: 'error' }),
    ]);
    const plain = parseStructure(
      asLines(['We the members agree to work together for the common good of all.']),
    );
    expect(plain.issues.map((issue) => issue.code)).toContain('no_structure');
    expect(plain.sections[0]!.needsReview).toBe(true);
  });

  it('never loses text: every extracted word ends up in a section', () => {
    const lines = sampleConstitutionLines('Word Check Club');
    const result = parseStructure(asLines(lines));
    const all = [
      result.title ?? '',
      ...result.sections.map((s) => `${s.number ?? ''} ${s.heading ?? ''} ${s.body}`),
    ].join(' ');
    for (const word of lines.join(' ').split(/\s+/)) {
      expect(all.toLowerCase(), word).toContain(word.toLowerCase().replace(/[.:;,-]+$/, ''));
    }
  });
});
