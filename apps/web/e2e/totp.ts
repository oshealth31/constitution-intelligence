// Authenticator codes for the browser tests (the same RFC 6238 maths as the API, written
// separately so the tests do not trust the code they are testing). Keys come from the
// development seed, which prints a new one each run.
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LAST_STEP_FILE = path.join(__dirname, '.auth', 'two-step-last-step.json');

const KEYS_FILE = path.join(__dirname, '.auth', 'two-step.json');

/** Two-step keys of the seeded accounts that have two-step sign-in, by email. */
export function twoStepKeys(): Record<string, string> {
  return JSON.parse(readFileSync(KEYS_FILE, 'utf8')) as Record<string, string>;
}

function decode(base32: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of base32.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function codeForStep(base32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decode(base32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

export function currentStep(): number {
  return Math.floor(Date.now() / 30_000);
}

/**
 * A code the API has not seen yet. Each code works once, so when the tests sign the same
 * person in twice within 30 seconds this uses the next step's code (the API accepts one step
 * of clock difference), and waits for a new step only if that was used too.
 */
export async function freshCode(email: string): Promise<string> {
  const key = twoStepKeys()[email];
  if (!key) throw new Error(`No two-step key for ${email} (see global-setup)`);
  const used: Record<string, number> = existsSync(LAST_STEP_FILE)
    ? (JSON.parse(readFileSync(LAST_STEP_FILE, 'utf8')) as Record<string, number>)
    : {};
  const last = used[email] ?? 0;
  while (Math.max(currentStep(), last + 1) > currentStep() + 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const step = Math.max(currentStep(), last + 1);
  used[email] = step;
  writeFileSync(LAST_STEP_FILE, JSON.stringify(used));
  return codeForStep(key, step);
}
