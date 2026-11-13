/**
 * Rules for organisation portal addresses ("slugs"), e.g. /o/sample-community-choir.
 * The database enforces the same rules (migrations 0001 and 0003).
 */

/** 3-50 characters: lower-case letters, numbers and hyphens, not starting or ending with a hyphen. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * Words the platform needs for itself. Keep in sync with the
 * organisations_slug_not_reserved constraint (migrations 0015, 0016) and the web app's copy in
 * apps/web/src/lib/short-link.ts.
 *
 * Since the short links (constitutionintel.com/<address>, Task "short portal link"), an
 * address shares the top level with the site's own pages, so this list also holds the pages
 * that exist today (offline, icons) and the usual pages a public website adds later.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'about',
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'blog',
  'careers',
  'contact',
  'control-centre',
  'docs',
  'faq',
  'forgot-password',
  'help',
  'icons',
  'invitations',
  'legal',
  'login',
  'logout',
  'manage',
  'news',
  'offline',
  'platform',
  'portal',
  'pricing',
  'privacy',
  'reset-password',
  'settings',
  'sign-in',
  'sign-out',
  'static',
  'status',
  'support',
  'terms',
  'www',
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}

/** True when `slug` can be used as a portal address. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}
