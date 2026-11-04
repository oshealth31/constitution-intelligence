// Test stand-in for the document worker: never answers and blocks its thread (Task D8 tests).
import { parentPort } from 'node:worker_threads';
parentPort?.once('message', () => {
  for (;;) {
    // a page that never finishes
  }
});
