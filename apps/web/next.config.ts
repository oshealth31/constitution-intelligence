import type { NextConfig } from 'next';

// Fixed policy for the small static offline page (inline <style>, no scripts).
// Kept in step with STATIC_PAGE_POLICY in src/lib/security-headers.ts (checked by a test).
const STATIC_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Security headers for every response. The page Content Security Policy (with a fresh nonce per
// page) is added in src/proxy.ts; static files get the fixed policy below.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HTTPS only, for a year. Browsers ignore this header on plain-HTTP local addresses.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

// Server-side address of the API. The browser never calls the API directly: requests to
// /api/v1/* on the web app are forwarded to it, so the session cookie stays on the web app's
// own address (first-party, HttpOnly). Read when the web app is built.
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(
  /\/+$/,
  '',
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/offline-fallback.html',
        headers: [{ key: 'Content-Security-Policy', value: STATIC_PAGE_POLICY }],
      },
      // The service worker must always be checked for updates.
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
