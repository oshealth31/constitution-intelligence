/**
 * Short portal links: constitutionintel.com/rbpc forwards to constitutionintel.com/o/rbpc, so
 * organisations can share a shorter link. The portal itself stays at /o/<address>.
 *
 * Only a single path segment that is a valid portal address is forwarded; the site's own
 * top-level pages are never touched. Whether the organisation exists is decided by the portal
 * page, which shows "not found" as it does for /o/<unknown>.
 */

/** Same rules as packages/shared/src/portal.ts (checked by short-link.test.ts). */
export const PORTAL_ADDRESS_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Same list as RESERVED_SLUGS in packages/shared/src/portal.ts (checked by short-link.test.ts). */
export const RESERVED_ADDRESSES: readonly string[] = [
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

/**
 * The portal path a short link forwards to, or null when the path is not a short link.
 * `/rbpc` and `/rbpc/` → `/o/rbpc`. Anything else (two segments, capitals, a dot, a reserved
 * word) → null, so the request is handled as usual.
 */
export function shortLinkTarget(pathname: string): string | null {
  const address = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!address) return null;
  if (!PORTAL_ADDRESS_PATTERN.test(address) || RESERVED_ADDRESSES.includes(address)) {
    return null;
  }
  return `/o/${address}`;
}
