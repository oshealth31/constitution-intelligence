/**
 * Password rules (in line with NIST SP 800-63B): long passwords, no forced complexity,
 * block obvious and very common choices. A check against breached-password lists
 * is planned for the security-hardening stage.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  'password1234',
  'password12345',
  'passwordpassword',
  'qwertyuiopas',
  'qwerty123456',
  'iloveyou1234',
  'administrator',
  'letmein12345',
  'welcome12345',
  'changeme1234',
  'abcdefghijkl',
  'botswana1234',
  'gaborone1234',
  'constitution',
  'constitution1',
  'constitution123',
]);

export interface PasswordContext {
  email?: string;
  displayName?: string;
}

/** Returns a plain-language problem, or null if the password is acceptable. */
export function checkPasswordPolicy(
  password: string,
  context: PasswordContext = {},
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`;
  }
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 2) {
    return 'Password is too repetitive. Try a short sentence or several unrelated words.';
  }
  if (COMMON_PASSWORDS.has(lower)) {
    return 'This password is too common. Please choose a different one.';
  }
  const emailName = context.email?.split('@')[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && lower.includes(emailName)) {
    return 'Password must not contain your email address.';
  }
  const name = context.displayName?.trim().toLowerCase();
  if (name && name.length >= 4 && lower.includes(name)) {
    return 'Password must not contain your name.';
  }
  return null;
}
