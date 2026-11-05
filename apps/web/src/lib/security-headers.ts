/**
 * Content Security Policy for the web app's pages.
 *
 * - Scripts: only this site's own files and scripts carrying this response's nonce.
 *   'strict-dynamic' lets those trusted scripts load the rest of the app.
 * - Styles: this site's own files only, in production (Task D13). Brand colours and bar widths
 *   are set as CSS variables from the site's own scripts (lib/css-properties.ts), never as
 *   style="" attributes or <style> blocks in the page.
 * - Images: this site (including the organisation logo, which the API serves) and data:/blob:
 *   for logo previews before upload.
 * - Connections: this site only. The browser never talks to the API or any AI provider directly.
 * - Nothing may frame the app (protects against "clickjacking"), and no plugins may load.
 *
 * In development, React needs 'unsafe-eval' for its debugging tools; production never allows it.
 */
export function buildContentSecurityPolicy(nonce: string, development = false): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    // Production: only this site's stylesheet files. No inline styles (Task D13): colours and
    // widths are set through the browser's style API from the site's own scripts. Development
    // keeps 'unsafe-inline' because the Next.js error screen needs it.
    'style-src': ["'self'", ...(development ? ["'unsafe-inline'"] : [])],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'media-src': ["'none'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  const policy = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
  return policy;
}

/**
 * Policy for the small static offline page (public/offline-fallback.html): no scripts, and
 * only its own <style> block, allowed by its SHA-256 fingerprint (Task D13). If that block is
 * edited, update the fingerprint here and in next.config.ts (a test recomputes it).
 */
export const STATIC_PAGE_POLICY =
  "default-src 'none'; style-src 'sha256-aqupHH3T9AP4iV5oIpLZbEo8/sjFjujINWfvQ/5o500='; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
