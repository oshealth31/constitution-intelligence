import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DocumentRejectedError, type DocumentFormat, type RawExtraction } from './extraction-types';
import type { WorkerReply, WorkerRequest } from './document-worker';

export interface DocumentParserOptions {
  /** Hard limit: the worker is stopped after this long, even in the middle of one page. */
  timeoutMs: number;
  /** Heap limit of each worker. */
  memoryMb: number;
  /** Documents read at the same time (per copy of the API). */
  concurrency: number;
  /** Documents that may wait for a free worker; beyond this the upload is refused as busy. */
  queueLimit: number;
  /** Worker script (tests use stand-ins); default: document-worker next to this file. */
  entry?: string;
}

export const PARSER_BUSY_MESSAGE =
  'The system is busy reading other documents. Please try again in a minute.';

export class ParserBusyError extends Error {
  constructor() {
    super(PARSER_BUSY_MESSAGE);
  }
}

export const TOO_SLOW_MESSAGE =
  'The document took too long to read. Please save it again (for example "Print to PDF" or "Save as" in Word) and upload that copy.';
export const TOO_COMPLEX_MESSAGE =
  'The document needs more memory to read than is allowed. Please save it again (for example "Print to PDF") and upload that copy.';

/** The compiled worker (dist/...js) or, in tests and development, the TypeScript source via tsx. */
function resolveEntry(entry: string | undefined): { file: string; execArgv: string[] } {
  const file = entry ?? path.join(__dirname, 'document-worker');
  for (const candidate of [file, `${file}.js`]) {
    if (candidate.endsWith('.js') && existsSync(candidate))
      return { file: candidate, execArgv: [] };
  }
  const source = file.endsWith('.ts') ? file : `${file}.ts`;
  return { file: source, execArgv: ['--import', 'tsx'] };
}

/**
 * Reads uploaded documents in separate worker threads (Task D8, risk U4). Each document gets
 * its own thread with a memory limit and a hard time limit (worker.terminate(), which stops
 * even code stuck in a loop). A small queue limits how many are read at once.
 */
export class DocumentParser {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: DocumentParserOptions) {}

  /** For tests and health information. */
  get load(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  async parse(format: DocumentFormat, content: Buffer): Promise<RawExtraction> {
    await this.acquire();
    try {
      return await this.runWorker(format, content);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.options.concurrency) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.options.queueLimit) {
      return Promise.reject(new ParserBusyError());
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.running -= 1;
    this.waiting.shift()?.();
  }

  private runWorker(format: DocumentFormat, content: Buffer): Promise<RawExtraction> {
    const { file, execArgv } = resolveEntry(this.options.entry);
    return new Promise<RawExtraction>((resolve, reject) => {
      const worker = new Worker(file, {
        execArgv,
        resourceLimits: {
          maxOldGenerationSizeMb: this.options.memoryMb,
          maxYoungGenerationSizeMb: Math.min(
            64,
            Math.max(8, Math.floor(this.options.memoryMb / 8)),
          ),
          stackSizeMb: 4,
        },
        // The worker gets nothing from the API's environment: no secrets, no database settings.
        env: {},
      });
      let settled = false;
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        outcome();
      };
      const timer = setTimeout(
        () => finish(() => reject(new DocumentRejectedError('too_slow', TOO_SLOW_MESSAGE))),
        this.options.timeoutMs,
      );
      worker.once('message', (reply: WorkerReply) => {
        finish(() => {
          if (reply.ok) resolve(reply.result);
          else if ('rejected' in reply)
            reject(new DocumentRejectedError(reply.rejected.code, reply.rejected.message));
          else reject(new Error(`The document reader failed (${reply.failed}).`));
        });
      });
      worker.once('error', (error: Error & { code?: string }) => {
        finish(() =>
          reject(
            error.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? new DocumentRejectedError('too_complex', TOO_COMPLEX_MESSAGE)
              : error,
          ),
        );
      });
      worker.once('exit', (code) => {
        finish(() => reject(new Error(`The document reader stopped unexpectedly (exit ${code}).`)));
      });
      // A copy of the bytes (the upload buffer may be shared with others).
      const copy = new Uint8Array(content);
      const request: WorkerRequest = { format, content: copy };
      worker.postMessage(request, [copy.buffer]);
    });
  }
}
