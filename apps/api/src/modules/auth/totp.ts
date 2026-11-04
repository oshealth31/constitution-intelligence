// Time-based one-time passwords (TOTP, RFC 6238) for two-step sign-in, using only node:crypto.
//
// The settings are the ones every common authenticator app uses by default: HMAC-SHA-1,
// six digits, a new code every 30 seconds. Checked against the RFC 6238 test vectors in
// two-step-units.spec.ts.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes from one step before or after are also accepted, to allow for a phone clock that is a little out. */
export const TOTP_WINDOW_STEPS = 1;
/** 20 random bytes (160 bits), as recommended by RFC 4226. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding: the format authenticator apps expect for the secret. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decodes base32 (case, spaces and padding ignored). Throws on any other character. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** HOTP (RFC 4226): the code for one counter value. */
export function hotp(
  secret: Uint8Array,
  counter: number,
  digits = TOTP_DIGITS,
  algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1',
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The 30-second time step for a moment in time. */
export function timeStep(at: Date | number = Date.now()): number {
  const milliseconds = typeof at === 'number' ? at : at.getTime();
  return Math.floor(milliseconds / 1000 / TOTP_PERIOD_SECONDS);
}

/** The current code for a base32 secret (used by tests and the development seed only). */
export function totpCode(secretBase32: string, at: Date | number = Date.now()): string {
  return hotp(base32Decode(secretBase32), timeStep(at));
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Checks a six-digit code. Returns the time step it belongs to, or null if it is wrong.
 * A code whose step is not later than `lastUsedStep` is refused, so a code (or an older one)
 * cannot be used again after a successful sign-in, as RFC 6238 section 5.2 requires.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { at?: Date | number; lastUsedStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  const current = timeStep(options.at ?? Date.now());
  let matched: number | null = null;
  // Check every step in the window (no early exit), so timing does not show which one matched.
  for (let step = current - TOTP_WINDOW_STEPS; step <= current + TOTP_WINDOW_STEPS; step += 1) {
    if (sameCode(hotp(secret, step), code) && matched === null) {
      matched = step;
    }
  }
  if (matched === null) {
    return null;
  }
  if (options.lastUsedStep !== null && options.lastUsedStep !== undefined) {
    if (matched <= options.lastUsedStep) {
      return null;
    }
  }
  return matched;
}

/** The otpauth:// address that authenticator apps read from the QR code. */
export function otpauthUrl(secretBase32: string, accountName: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const parameters = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
