import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy } from './lib/security-headers';

/**
 * Adds a strict Content Security Policy to every page. Each response gets a fresh random
 * "nonce": only scripts carrying it (the ones Next.js itself adds) may run, so a script
 * injected into a page by an attacker is blocked by the browser.
 *
 * Next.js reads the policy from the request headers and puts the nonce on its own scripts.
 * Pages are therefore rendered per request (see the root layout).
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API (it sets its own headers), Next.js build files or static files.
      source:
        '/((?!api/|_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|offline-fallback\\.html|favicon\\.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
