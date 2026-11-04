import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  timeStep,
  totpCode,
  verifyTotp,
} from './totp';
import {
  TwoStepCrypto,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normaliseRecoveryCode,
} from './two-step-crypto';
import { cleanCode } from './two-step.service';

describe('HOTP (RFC 4226 appendix D test values)', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it('produces the published code for counters 0-9', () => {
    expect(expected.map((_, counter) => hotp(secret, counter))).toEqual(expected);
  });
});

describe('TOTP (RFC 6238 appendix B test vectors)', () => {
  const seeds = {
    sha1: Buffer.from('12345678901234567890', 'ascii'),
    sha256: Buffer.from('12345678901234567890123456789012', 'ascii'),
    sha512: Buffer.from(
      '1234567890123456789012345678901234567890123456789012345678901234',
      'ascii',
    ),
  };
  const vectors: [number, string, 'sha1' | 'sha256' | 'sha512'][] = [
    [59, '94287082', 'sha1'],
    [59, '46119246', 'sha256'],
    [59, '90693936', 'sha512'],
    [1111111109, '07081804', 'sha1'],
    [1111111109, '68084774', 'sha256'],
    [1111111109, '25091201', 'sha512'],
    [1111111111, '14050471', 'sha1'],
    [1111111111, '67062674', 'sha256'],
    [1111111111, '99943326', 'sha512'],
    [1234567890, '89005924', 'sha1'],
    [1234567890, '91819424', 'sha256'],
    [1234567890, '93441116', 'sha512'],
    [2000000000, '69279037', 'sha1'],
    [2000000000, '90698825', 'sha256'],
    [2000000000, '38618901', 'sha512'],
    [20000000000, '65353130', 'sha1'],
    [20000000000, '77737706', 'sha256'],
    [20000000000, '47863826', 'sha512'],
  ];
  it.each(vectors)('at %i seconds gives %s (%s)', (seconds, code, algorithm) => {
    expect(hotp(seeds[algorithm], timeStep(seconds * 1000), 8, algorithm)).toBe(code);
  });

  it('agrees with the six-digit code an authenticator app shows for the same secret', () => {
    const base32 = base32Encode(seeds.sha1);
    expect(base32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    // The last six digits of the RFC value: apps show six digits by default.
    expect(totpCode(base32, 59_000)).toBe('287082');
  });
});

describe('base32', () => {
  it('round-trips random bytes and ignores case, spaces and padding', () => {
    for (let index = 0; index < 20; index += 1) {
      const bytes = randomBytes(index + 1);
      const encoded = base32Encode(bytes);
      expect(base32Decode(encoded)).toEqual(bytes);
      expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, '$1 ') + '==')).toEqual(bytes);
    }
  });
  it('refuses characters that are not base32', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
  it('makes 160-bit secrets (32 characters)', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 10, 4, 12, 0, 10);
  const step = timeStep(now);

  it('accepts the current code and one step either side (phone clock drift)', () => {
    expect(verifyTotp(secret, totpCode(secret, now), { at: now })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), { at: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), { at: now })).toBe(step + 1);
  });
  it('refuses codes from further away, malformed codes and another secret', () => {
    expect(verifyTotp(secret, totpCode(secret, now - 60_000), { at: now })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 60_000), { at: now })).toBeNull();
    expect(verifyTotp(secret, '12345', { at: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { at: now })).toBeNull();
    expect(verifyTotp(generateTotpSecret(), totpCode(secret, now), { at: now })).toBeNull();
  });
  it('refuses a code that was already used, or an older one (replay protection)', () => {
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, { at: now, lastUsedStep: step })).toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, now - 30_000), { at: now, lastUsedStep: step }),
    ).toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, now + 30_000), { at: now, lastUsedStep: step }),
    ).toBe(step + 1);
  });
  it('accepts codes typed with a space or dash', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(cleanCode('123-456')).toBe('123456');
  });
});

describe('otpauth address for the QR code', () => {
  it('names the issuer and account and uses the standard settings', () => {
    const url = new URL(otpauthUrl('ABCDEFGH', 'person@example.test', 'Constitution Intelligence'));
    expect(url.protocol).toBe('otpauth:');
    expect(decodeURIComponent(url.pathname)).toContain(
      'Constitution Intelligence:person@example.test',
    );
    expect(url.searchParams.get('secret')).toBe('ABCDEFGH');
    expect(url.searchParams.get('issuer')).toBe('Constitution Intelligence');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
    expect(url.searchParams.get('algorithm')).toBe('SHA1');
  });
});

describe('encryption of authenticator secrets at rest', () => {
  const crypto = new TwoStepCrypto(randomBytes(32));
  const userId = '7d3c3f4e-1111-4222-8333-944455556666';
  const secret = generateTotpSecret();

  it('stores neither the secret nor anything that reveals it, and decrypts with the right key', () => {
    const stored = crypto.encryptSecret(secret, userId);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(secret);
    expect(crypto.encryptSecret(secret, userId)).not.toBe(stored); // a new random IV each time
    expect(crypto.decryptSecret(stored, userId)).toBe(secret);
  });
  it('refuses a changed value, another person, or another key', () => {
    const stored = crypto.encryptSecret(secret, userId);
    const [version, iv, tag, body] = stored.split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      crypto.decryptSecret([version, iv, tag, flipped.toString('base64url')].join('.'), userId),
    ).toThrow();
    expect(() => crypto.decryptSecret(stored, '7d3c3f4e-1111-4222-8333-000000000000')).toThrow();
    expect(() => new TwoStepCrypto(randomBytes(32)).decryptSecret(stored, userId)).toThrow();
    expect(() => crypto.decryptSecret('plain-text', userId)).toThrow();
  });
  it('refuses a key that is not 32 bytes', () => {
    expect(() => new TwoStepCrypto(randomBytes(16))).toThrow();
  });
});

describe('recovery codes', () => {
  it('makes ten different, easy-to-read codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      expect(looksLikeRecoveryCode(code)).toBe(true);
    }
  });
  it('matches however the code is typed, and stores only a keyed hash', () => {
    const crypto = new TwoStepCrypto(randomBytes(32));
    const userId = '7d3c3f4e-1111-4222-8333-944455556666';
    const hash = crypto.hashRecoveryCode('k7dm2-q9xwe', userId);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('k7dm2');
    expect(crypto.hashRecoveryCode(' K7DM2 Q9XWE ', userId)).toBe(hash);
    expect(normaliseRecoveryCode('K7DM2-Q9XWE')).toBe('k7dm2q9xwe');
    // Bound to the person and to the key.
    expect(crypto.hashRecoveryCode('k7dm2-q9xwe', '7d3c3f4e-1111-4222-8333-000000000000')).not.toBe(
      hash,
    );
    expect(new TwoStepCrypto(randomBytes(32)).hashRecoveryCode('k7dm2-q9xwe', userId)).not.toBe(
      hash,
    );
  });
});
