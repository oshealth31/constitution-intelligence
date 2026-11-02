import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('keeps a safe incoming request ID', () => {
    expect(resolveRequestId('support-ticket-12345')).toBe('support-ticket-12345');
  });

  it('replaces missing, too short, repeated or unsafe values with a new UUID', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(undefined)).toMatch(uuid);
    expect(resolveRequestId('short')).toMatch(uuid);
    expect(resolveRequestId(['a-safe-value-1', 'a-safe-value-2'])).toMatch(uuid);
    expect(resolveRequestId('<script>alert(1)</script>')).toMatch(uuid);
  });
});
