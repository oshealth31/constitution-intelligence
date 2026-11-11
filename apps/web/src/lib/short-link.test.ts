import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, SLUG_PATTERN } from '../../../../packages/shared/src/portal';
import { PORTAL_ADDRESS_PATTERN, RESERVED_ADDRESSES, shortLinkTarget } from './short-link';

describe('short portal links', () => {
  it('forwards a single portal address to its portal', () => {
    expect(shortLinkTarget('/rbpc')).toBe('/o/rbpc');
    expect(shortLinkTarget('/rbpc/')).toBe('/o/rbpc');
    expect(shortLinkTarget('/sample-community-choir')).toBe('/o/sample-community-choir');
  });

  it('leaves everything else alone', () => {
    for (const pathname of [
      '/',
      '/o/rbpc',
      '/rbpc/sign-in',
      '/RBPC',
      '/ab',
      '/-rbpc',
      '/sw.js',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/offline-fallback.html',
      '/admin',
      '/offline',
      '/forgot-password',
      '/reset-password',
      '/icons',
      '/pricing',
      '/%2e%2e',
    ]) {
      expect(shortLinkTarget(pathname), pathname).toBeNull();
    }
  });

  it('uses the same address rules as the API and the database', () => {
    expect(PORTAL_ADDRESS_PATTERN.source).toBe(SLUG_PATTERN.source);
    expect([...RESERVED_ADDRESSES].sort()).toEqual([...RESERVED_SLUGS].sort());
  });

  it("never shadows one of the web app's own top-level pages", () => {
    // Every folder directly under src/app (a page) and every file in public/ must be reserved
    // or impossible as an address, or an organisation could take its name.
    const appDir = path.resolve(__dirname, '../app');
    const publicDir = path.resolve(__dirname, '../../public');
    const names = [
      ...readdirSync(appDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('('))
        .map((entry) => entry.name),
      ...readdirSync(publicDir),
    ];
    for (const name of names) {
      expect(shortLinkTarget(`/${name}`), name).toBeNull();
    }
  });
});
