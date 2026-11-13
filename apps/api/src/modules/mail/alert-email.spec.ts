import { describe, expect, it } from 'vitest';
import { buildAlertEmail, parseAlertRecipients } from './alert-email';

describe('alert emails', () => {
  it('reads recipients separated by commas, spaces or lines, without duplicates', () => {
    expect(parseAlertRecipients('A@example.org, b@example.org\nb@example.org')).toEqual([
      'a@example.org',
      'b@example.org',
    ]);
  });

  it('refuses an empty list, a bad address or too many', () => {
    expect(() => parseAlertRecipients('  ')).toThrow();
    expect(() => parseAlertRecipients('not-an-email')).toThrow();
    expect(() => parseAlertRecipients('a@x.org b@x.org c@x.org d@x.org e@x.org f@x.org')).toThrow();
  });

  it('lists the findings, one per line, with no injected lines', () => {
    const message = buildAlertEmail('constitutionintel.com', [
      'PROBLEM: disk 85% full',
      'PROBLEM: line\nwith a break',
    ]);
    expect(message.text).toContain('constitutionintel.com');
    expect(message.text).toContain('PROBLEM: disk 85% full');
    expect(message.text).toContain('PROBLEM: line with a break');
  });
});
