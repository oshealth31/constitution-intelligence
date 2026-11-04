// Test stand-in for the document worker: uses more and more memory (Task D8 tests).
import { parentPort } from 'node:worker_threads';
parentPort?.once('message', () => {
  const hoard: string[][] = [];
  for (;;) hoard.push(new Array(100_000).fill('a document that never stops growing'));
});
