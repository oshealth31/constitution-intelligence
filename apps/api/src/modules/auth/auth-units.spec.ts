import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy';
import { PasswordService } from './password.service';
import { readSessionToken } from './session-cookie';
import { generateToken, hashToken } from './tokens';

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(checkPasswordPolicy('river stones under a quiet bridge')).toBeNull();
  });

  it('rejects short, repetitive, common and personal passwords', () => {
    expect(checkPasswordPolicy('short1!')).toMatch(/at least 12/);
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa')).toMatch(/repetitive/);
    expect(checkPasswordPolicy('Password1234')).toMatch(/too common/);
    expect(checkPasswordPolicy('naledi-secret-2026', { email: 'naledi@example.test' })).toMatch(
      /email/,
    );
    expect(checkPasswordPolicy('x'.repeat(10) + 'y'.repeat(119))).toMatch(/at most 128/);
  });
});

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('stores Argon2id hashes, never the password itself', async () => {
    const stored = await passwords.hash('river stones under a quiet bridge');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).not.toContain('river');
    expect(await passwords.verify(stored, 'river stones under a quiet bridge')).toBe(true);
    expect(await passwords.verify(stored, 'wrong password entirely')).toBe(false);
  });

  it('returns false (without throwing) when there is no stored hash', async () => {
    expect(await passwords.verify(null, 'anything at all here')).toBe(false);
  });

  it('produces a different hash each time for the same password (random salt)', async () => {
    const a = await passwords.hash('same password twice');
    const b = await passwords.hash('same password twice');
    expect(a).not.toBe(b);
  });
});

describe('tokens', () => {
  it('generates long random tokens and stores only a one-way hash', () => {
    const token = generateToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

describe('readSessionToken', () => {
  const requestWith = (cookie?: string) => ({ headers: { cookie } }) as unknown as Request;

  it('reads the session cookie among others', () => {
    const token = generateToken();
    expect(readSessionToken(requestWith(`theme=dark; ci_session=${token}; other=1`))).toBe(token);
  });

  it('ignores missing or malformed values', () => {
    expect(readSessionToken(requestWith())).toBeUndefined();
    expect(readSessionToken(requestWith('ci_session=<script>'))).toBeUndefined();
    expect(readSessionToken(requestWith('ci_session=short'))).toBeUndefined();
  });
});
