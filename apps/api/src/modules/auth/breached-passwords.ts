// Check against passwords known from data leaks (Task D5). Offline: nothing about a password
// ever leaves the server. The list (apps/api/data/breached-passwords.bin) holds the first
// 6 bytes of the SHA-256 of each lower-cased leaked password of 12-128 characters, sorted;
// it is built by scripts/build-breached-password-list.py from SecLists (MIT licence), about
// 738,000 passwords. See apps/api/data/README.md.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const BREACHED_PREFIX_BYTES = 6;
export const BREACHED_LIST_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'data',
  'breached-passwords.bin',
);

let list: Buffer | null = null;

/** Loads the list once (about 4.4 MB). Throws if it is missing or damaged. */
export function loadBreachedPasswordList(file = BREACHED_LIST_FILE): Buffer {
  if (list && file === BREACHED_LIST_FILE) return list;
  const data = readFileSync(file);
  if (data.length === 0 || data.length % BREACHED_PREFIX_BYTES !== 0) {
    throw new Error('The breached-password list is damaged (wrong size).');
  }
  if (file === BREACHED_LIST_FILE) list = data;
  return data;
}

/** Number of passwords in the list. */
export function breachedPasswordCount(): number {
  return loadBreachedPasswordList().length / BREACHED_PREFIX_BYTES;
}

/** True when the password (ignoring upper/lower case) is in the list of leaked passwords. */
export function isBreachedPassword(password: string, data = loadBreachedPasswordList()): boolean {
  const key = createHash('sha256')
    .update(password.toLowerCase(), 'utf8')
    .digest()
    .subarray(0, BREACHED_PREFIX_BYTES);
  let low = 0;
  let high = data.length / BREACHED_PREFIX_BYTES - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const start = middle * BREACHED_PREFIX_BYTES;
    const order = Buffer.compare(data.subarray(start, start + BREACHED_PREFIX_BYTES), key);
    if (order === 0) return true;
    if (order < 0) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}
