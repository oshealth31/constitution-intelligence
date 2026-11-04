import { describe, expect, it } from 'vitest';
import { buildTestEmail } from './test-email';

describe('buildTestEmail', () => {
  it('links to the site with a marker, in both versions', () => {
    const message = buildTestEmail('https://constitutionintel.com/', 'abc123');
    expect(message.link).toBe('https://constitutionintel.com/?email-test=abc123');
    expect(message.text).toContain('https://constitutionintel.com/?email-test=abc123');
    expect(message.html).toContain('href="https://constitutionintel.com/?email-test=abc123"');
    expect(message.html).not.toMatch(/<img|<script/);
  });
});
