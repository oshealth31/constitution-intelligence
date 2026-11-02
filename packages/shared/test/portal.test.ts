import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, isReservedSlug, isValidSlug } from '../src/portal';

describe('portal addresses', () => {
  it('accepts ordinary organisation addresses', () => {
    expect(isValidSlug('sample-community-choir')).toBe(true);
    expect(isValidSlug('abc')).toBe(true);
    expect(isValidSlug('club-2026')).toBe(true);
  });

  it('refuses badly formed addresses', () => {
    for (const slug of ['ab', '-choir', 'choir-', 'Choir', 'choir club', 'choir/../admin', 'a'.repeat(51)]) {
      expect(isValidSlug(slug), slug).toBe(false);
    }
  });

  it('refuses words reserved for the platform', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isValidSlug('admin')).toBe(false);
    expect(isValidSlug('sign-in')).toBe(false);
    // Every reserved word would otherwise be a valid address, so the list really matters.
    for (const slug of RESERVED_SLUGS) {
      expect(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug), slug).toBe(true);
    }
  });
});
