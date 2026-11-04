import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BREACHED_PREFIX_BYTES,
  breachedPasswordCount,
  isBreachedPassword,
  loadBreachedPasswordList,
} from './breached-passwords';
import { BREACHED_MESSAGE, checkPasswordPolicy } from './password-policy';

describe('leaked-password check (offline list)', () => {
  it('loads the shipped list: about 738,000 entries, sorted, no duplicates', () => {
    const data = loadBreachedPasswordList();
    expect(breachedPasswordCount()).toBeGreaterThan(700_000);
    for (
      let offset = BREACHED_PREFIX_BYTES;
      offset < data.length;
      offset += BREACHED_PREFIX_BYTES
    ) {
      const previous = data.subarray(offset - BREACHED_PREFIX_BYTES, offset);
      const current = data.subarray(offset, offset + BREACHED_PREFIX_BYTES);
      if (Buffer.compare(previous, current) >= 0) {
        throw new Error(`list not strictly sorted at entry ${offset / BREACHED_PREFIX_BYTES}`);
      }
    }
  });

  it('finds well-known leaked passwords of 12+ characters, whatever their case', () => {
    for (const leaked of ['q1w2e3r4t5y6', '1qaz2wsx3edc', 'qwerty123456', 'startfinding']) {
      expect(isBreachedPassword(leaked), leaked).toBe(true);
      expect(isBreachedPassword(leaked.toUpperCase()), leaked).toBe(true);
    }
  });

  it('does not flag unusual passphrases', () => {
    for (const fine of [
      'correct horse battery staple',
      'my aunt grows mangoes in Maun',
      `${Math.random().toString(36)} plus a few words`,
    ]) {
      expect(isBreachedPassword(fine), fine).toBe(false);
    }
  });

  it('refuses a leaked password with a plain message, after the other rules', () => {
    expect(checkPasswordPolicy('1qaz2wsx3edc')).toBe(BREACHED_MESSAGE);
    expect(checkPasswordPolicy('Password1234')).toMatch(/too common/);
    expect(checkPasswordPolicy('short')).toMatch(/at least 12/);
    expect(checkPasswordPolicy('my aunt grows mangoes in Maun')).toBeNull();
  });

  it('works on a small list and refuses a damaged file', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'breached-'));
    const entries = ['alpha passphrase one', 'beta passphrase two']
      .map((word) => createHash('sha256').update(word).digest().subarray(0, BREACHED_PREFIX_BYTES))
      .sort(Buffer.compare);
    const good = path.join(folder, 'good.bin');
    writeFileSync(good, Buffer.concat(entries));
    const small = loadBreachedPasswordList(good);
    expect(isBreachedPassword('Alpha Passphrase One', small)).toBe(true);
    expect(isBreachedPassword('gamma passphrase three', small)).toBe(false);
    const damaged = path.join(folder, 'damaged.bin');
    writeFileSync(damaged, Buffer.alloc(7));
    expect(() => loadBreachedPasswordList(damaged)).toThrow(/damaged/);
  });
});
