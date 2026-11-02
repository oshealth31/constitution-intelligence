import { createHash, randomBytes } from 'node:crypto';

/**
 * A new random secret (256 bits) for session cookies, password-reset links and invitations.
 * Only its SHA-256 hash is stored, so a copy of the database cannot be used to sign in.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A long random password for fictional development accounts (never a fixed default). */
export function generateRandomPassword(): string {
  return randomBytes(18).toString('base64url');
}
