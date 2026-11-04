import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DocumentParser,
  ParserBusyError,
  TOO_COMPLEX_MESSAGE,
  TOO_SLOW_MESSAGE,
} from './document-parser';
import { makeSampleDocx, makeSamplePdf } from '../../dev/sample-documents';

const WORKERS = path.resolve(__dirname, '..', '..', '..', 'test', 'support', 'workers');
const parser = (
  entry: string | undefined,
  overrides: Partial<ConstructorParameters<typeof DocumentParser>[0]> = {},
) =>
  new DocumentParser({
    timeoutMs: 20_000,
    // The production default (DOCUMENT_PARSE_MEMORY_MB): PDF.js needs most of it.
    memoryMb: 256,
    concurrency: 2,
    queueLimit: 2,
    entry: entry ? path.join(WORKERS, entry) : undefined,
    ...overrides,
  });

describe('document reading in a separate worker (Task D8)', () => {
  it('reads real PDF and Word files through the worker', async () => {
    const real = parser(undefined);
    const pdf = await real.parse(
      'pdf',
      makeSamplePdf([[{ text: '1. Name' }, { text: 'The name is the Sample Club.' }]]),
    );
    expect(pdf.lines.map((line) => line.text)).toContain('1. Name');
    const docx = await real.parse('docx', makeSampleDocx([{ text: 'Article 1 Name' }]));
    expect(docx.lines.map((line) => line.text).join(' ')).toContain('Name');
  });

  it('passes on a refusal from the reader with its plain message', async () => {
    await expect(
      parser(undefined).parse('pdf', Buffer.from('%PDF-1.4\nnot really a pdf')),
    ).rejects.toMatchObject({ code: 'invalid_pdf' });
  });

  it('stops a reader stuck inside one page at the time limit, while the server keeps working', async () => {
    const started = Date.now();
    let ticks = 0;
    const ticker = setInterval(() => (ticks += 1), 50);
    try {
      await expect(
        parser('hang.ts', { timeoutMs: 1_500 }).parse('pdf', Buffer.from('%PDF-1.4')),
      ).rejects.toMatchObject({ code: 'too_slow', message: TOO_SLOW_MESSAGE });
    } finally {
      clearInterval(ticker);
    }
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
    // The main thread was never blocked: its timer kept firing while the worker was stuck.
    expect(ticks).toBeGreaterThan(10);
  });

  it('stops a reader that uses too much memory', async () => {
    await expect(
      parser('memory.ts', { memoryMb: 64, timeoutMs: 20_000 }).parse(
        'pdf',
        Buffer.from('%PDF-1.4'),
      ),
    ).rejects.toMatchObject({ code: 'too_complex', message: TOO_COMPLEX_MESSAGE });
  });

  it('reads at most N at once, queues a few more and refuses beyond that', async () => {
    const queued = parser('slow-echo.ts', { concurrency: 1, queueLimit: 1 });
    const first = queued.parse('pdf', Buffer.from('a'));
    const second = queued.parse('pdf', Buffer.from('b'));
    expect(queued.load).toEqual({ running: 1, waiting: 1 });
    await expect(queued.parse('pdf', Buffer.from('c'))).rejects.toBeInstanceOf(ParserBusyError);
    await expect(first).resolves.toMatchObject({ pageCount: 1 });
    await expect(second).resolves.toMatchObject({ pageCount: 1 });
    expect(queued.load).toEqual({ running: 0, waiting: 0 });
  });
});
