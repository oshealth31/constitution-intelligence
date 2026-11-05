import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, STATIC_PAGE_POLICY } from './security-headers';

describe('buildContentSecurityPolicy', () => {
  it('allows only nonce-carrying scripts in production', () => {
    const policy = buildContentSecurityPolicy('abc123');
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('blocks framing, plugins and foreign connections', () => {
    const policy = buildContentSecurityPolicy('n');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("base-uri 'self'");
  });

  it('allows no inline styles in production (Task D13)', () => {
    expect(buildContentSecurityPolicy('n')).toContain("style-src 'self';");
    expect(buildContentSecurityPolicy('n')).not.toContain('unsafe-inline');
    expect(buildContentSecurityPolicy('n', true)).toMatch(/style-src 'self' 'unsafe-inline'/);
  });

  it("allows the offline page's own <style> block by its fingerprint only", () => {
    const html = readFileSync(
      path.resolve(process.cwd(), 'public', 'offline-fallback.html'),
      'utf8',
    );
    const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    expect(blocks).toHaveLength(1);
    expect(html).not.toMatch(/style="/);
    const hash = createHash('sha256').update(blocks[0]![1]!, 'utf8').digest('base64');
    expect(STATIC_PAGE_POLICY).toContain(`style-src 'sha256-${hash}'`);
    expect(STATIC_PAGE_POLICY).not.toContain('unsafe-inline');
  });

  it('allows eval only in development', () => {
    expect(buildContentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
  });

  it('matches the static-page policy written in next.config.ts', () => {
    const config = readFileSync(path.resolve(process.cwd(), 'next.config.ts'), 'utf8');
    expect(config.replace(/\s+/g, ' ')).toContain(`"${STATIC_PAGE_POLICY}"`);
  });
});
