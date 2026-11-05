import { describe, expect, it } from 'vitest';
import { buildSuperAdminSetupEmail } from './super-admin-email';

describe('buildSuperAdminSetupEmail', () => {
  it('carries the one-time link and its expiry in both versions', () => {
    const link = 'https://constitutionintel.com/reset-password?token=abc';
    const message = buildSuperAdminSetupEmail('Kabelo\nInjected', link, 60);
    expect(message.text).toContain(link);
    expect(message.text).toContain('expires in 60 minutes');
    expect(message.html).toContain(`href="${link}"`);
    // The name is kept on one line, so it cannot add lines to the message.
    expect(message.text).toContain('Hello Kabelo Injected,');
    expect(message.html).not.toMatch(/<img|<script/);
  });
});
