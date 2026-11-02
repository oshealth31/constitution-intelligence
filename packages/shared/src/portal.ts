/**
 * Rules for organisation portal addresses ("slugs"), e.g. /o/sample-community-choir.
 * The database enforces the same rules (migrations 0001 and 0003).
 */

/** 3-50 characters: lower-case letters, numbers and hyphens, not starting or ending with a hyphen. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * Words the platform needs for itself. Keep in sync with the
 * organisations_slug_not_reserved constraint in migration 0003.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'control-centre',
  'forgot-password',
  'help',
  'login',
  'logout',
  'manage',
  'platform',
  'portal',
  'reset-password',
  'settings',
  'sign-in',
  'sign-out',
  'static',
  'status',
  'support',
  'www',
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}

/** True when `slug` can be used as a portal address. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}
