// Test stand-in for the document worker: answers after a short wait (queue tests, Task D8).
import { parentPort } from 'node:worker_threads';
parentPort?.once('message', () => {
  setTimeout(() => {
    parentPort?.postMessage({
      ok: true,
      result: { format: 'pdf', lines: [{ text: 'ok' }], pageCount: 1, issues: [] },
    });
  }, 400);
});
