// Runs in a separate worker thread (Task D8): reads ONE uploaded document and sends the result
// back. The main API sets hard memory limits on this thread and stops it outright if it takes
// too long, so a malicious or broken file cannot freeze or exhaust the server.
import { parentPort } from 'node:worker_threads';
import { extractDocx } from './docx-extractor';
import { DocumentRejectedError, type DocumentFormat } from './extraction-types';
import { extractPdf } from './pdf-extractor';

export interface WorkerRequest {
  format: DocumentFormat;
  content: Uint8Array;
}

export type WorkerReply =
  | { ok: true; result: Awaited<ReturnType<typeof extractPdf>> }
  | { ok: false; rejected: { code: string; message: string } }
  | { ok: false; failed: string };

parentPort?.once('message', (request: WorkerRequest) => {
  void (async () => {
    let reply: WorkerReply;
    try {
      const content = Buffer.from(
        request.content.buffer,
        request.content.byteOffset,
        request.content.byteLength,
      );
      const result = request.format === 'pdf' ? await extractPdf(content) : extractDocx(content);
      reply = { ok: true, result };
    } catch (error) {
      reply =
        error instanceof DocumentRejectedError
          ? { ok: false, rejected: { code: error.code, message: error.message } }
          : { ok: false, failed: error instanceof Error ? error.name : 'unknown' };
    }
    parentPort?.postMessage(reply);
  })();
});
