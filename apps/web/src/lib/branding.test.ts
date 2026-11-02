import { describe, expect, it } from 'vitest';
import {
  brandStyle,
  colourWarnings,
  contrastRatio,
  initials,
  readableTextOn,
  safeColour,
} from './branding';

describe('branding colours', () => {
  it('accepts only exact #RRGGBB colours', () => {
    expect(safeColour('#4a2b6b', '#000000')).toBe('#4A2B6B');
    for (const unsafe of [
      'red',
      '#FFF',
      'url(https://evil.test)',
      '#000000; background:url(x)',
      'var(--x)',
      null,
      42,
    ]) {
      expect(safeColour(unsafe, '#0B1F3A')).toBe('#0B1F3A');
    }
  });

  it('never puts an unsafe value into the page styles', () => {
    const style = brandStyle({
      primary: 'red; background: url(https://evil.test/steal)',
      secondary: '#ffffff',
      accent: 'expression(alert(1))',
    }) as Record<string, string>;
    expect(style['--brand-primary']).toBe('#0B1F3A');
    expect(style['--brand-secondary']).toBe('#FFFFFF');
    expect(style['--brand-accent']).toBe('#1BA6A6');
    expect(Object.values(style).every((value) => /^#[0-9A-F]{6}$/.test(value))).toBe(true);
  });

  it('calculates contrast like the accessibility guidelines', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('chooses readable text for any background', () => {
    expect(readableTextOn('#0E5A3A')).toBe('#FFFFFF');
    expect(readableTextOn('#F6EEDC')).toBe('#111827');
    expect(readableTextOn('#F28C28')).toBe('#111827');
  });

  it('falls back to navy for links when the primary colour is too light', () => {
    const style = brandStyle({ primary: '#FFE066' }) as Record<string, string>;
    expect(style['--brand-ink']).toBe('#0B1F3A');
    const dark = brandStyle({ primary: '#4A2B6B' }) as Record<string, string>;
    expect(dark['--brand-ink']).toBe('#4A2B6B');
  });

  it('warns administrators about hard-to-read choices', () => {
    expect(colourWarnings({ primary: '#4A2B6B', secondary: '#F6EEDC', accent: '#D9A21B' })).toEqual(
      [],
    );
    expect(
      colourWarnings({ primary: '#FFE066', secondary: '#F6EEDC', accent: '#D9A21B' }).length,
    ).toBeGreaterThan(0);
  });

  it('makes initials for a logo placeholder', () => {
    expect(initials('Sample Netball Club')).toBe('SN');
    expect(initials('Choir (fictional)')).toBe('C');
    expect(initials('  ')).toBe('?');
  });
});
