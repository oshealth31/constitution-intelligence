// Protection for two-step sign-in data at rest.
//
// - Authenticator secrets are encrypted with AES-256-GCM. The user id is bound in as
//   "additional authenticated data", so an encrypted secret copied onto another person's row
//   does not decrypt.
// - Recovery codes are stored as HMAC-SHA-256 hashes, keyed with a key derived from the same
//   master key, so a stolen database copy alone is not enough to try codes offline.
//
// The master key is MFA_ENCRYPTION_KEY (required in staging and production). Local development
// and tests use a fixed key derived from a public phrase: it protects nothing and is refused by
// the configuration rules outside those environments.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
} from 'node:crypto';
import type { AppConfig } from '../../config/config';

const VERSION = 'v1';
const IV_BYTES = 12;

/** Development and test only. Not secret: anyone can work it out from this file. */
export function developmentOnlyTwoStepKey(): Buffer {
  return createHash('sha256')
    .update('constitution-intelligence: local development and tests only, not a secret')
    .digest();
}

/** The master key from the configuration (or the public development key when it is not set). */
export function twoStepMasterKey(config: Pick<AppConfig, 'MFA_ENCRYPTION_KEY'>): Buffer {
  return config.MFA_ENCRYPTION_KEY
    ? Buffer.from(config.MFA_ENCRYPTION_KEY, 'hex')
    : developmentOnlyTwoStepKey();
}

function subKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), purpose, 32));
}

export class TwoStepCrypto {
  private readonly encryptionKey: Buffer;
  private readonly recoveryKey: Buffer;

  constructor(master: Buffer) {
    if (master.length !== 32) {
      throw new Error('The two-step master key must be 32 bytes');
    }
    this.encryptionKey = subKey(master, 'two-step secret encryption v1');
    this.recoveryKey = subKey(master, 'two-step recovery code hashing v1');
  }

  encryptSecret(secretBase32: string, userId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(userId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws if the value was changed, belongs to another user, or was encrypted with another key. */
  decryptSecret(stored: string, userId: string): string {
    const [version, iv, tag, ciphertext] = stored.split('.');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Unrecognised two-step secret format');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  hashRecoveryCode(code: string, userId: string): string {
    return createHmac('sha256', this.recoveryKey)
      .update(`${userId}:${normaliseRecoveryCode(code)}`)
      .digest('hex');
  }
}

export const RECOVERY_CODE_COUNT = 10;
/** No 0/O, 1/l/I: easy to read back from paper. 31 characters x 10 = about 50 bits per code. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Ten random recovery codes like "k7dm2-q9xwe". */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    let raw = '';
    for (let index = 0; index < 10; index += 1) {
      raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Lower case, without spaces or dashes, so "K7DM2 Q9XWE" matches "k7dm2-q9xwe". */
export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

export function looksLikeRecoveryCode(code: string): boolean {
  return /^[a-z0-9]{10}$/.test(normaliseRecoveryCode(code));
}
