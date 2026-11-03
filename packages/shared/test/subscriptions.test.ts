import { describe, expect, it } from 'vitest';
import { containsCardNumber, formatMoney } from '../src/subscriptions';

describe('containsCardNumber', () => {
  it('spots card numbers (Luhn-valid, 13-19 digits), with or without spaces', () => {
    expect(containsCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(containsCardNumber('paid with 5500-0000-0000-0004')).toBe(true);
    expect(containsCardNumber('378282246310005')).toBe(true);
  });

  it('does not mistake ordinary payment references for card numbers', () => {
    expect(containsCardNumber('EFT 2026-11-03 RBPC')).toBe(false);
    expect(containsCardNumber('FNB ref 1234567')).toBe(false);
    expect(containsCardNumber('4111 1111 1111 1112')).toBe(false); // fails the Luhn check
  });
});

describe('formatMoney', () => {
  it('shows amounts in pula from thebe', () => {
    expect(formatMoney(125_000)).toBe('BWP 1,250.00');
    expect(formatMoney(5, 'BWP')).toBe('BWP 0.05');
  });
});
