/**
 * Content Security Policy for the web app's pages.
 *
 * - Scripts: only this site's own files and scripts carrying this response's nonce.
 *   'strict-dynamic' lets those trusted scripts load the rest of the app.
 * - Styles: this site's own files plus inline styles (the app sets brand colours with style
 *   attributes). Styles cannot run code; the risk accepted here is limited to page appearance.
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
    'style-src': ["'self'", "'unsafe-inline'"],
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

/** Policy for the small static offline page, which has an inline <style> and no scripts. */
export const STATIC_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
