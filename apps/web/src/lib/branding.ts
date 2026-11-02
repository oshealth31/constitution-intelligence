import type { CSSProperties } from 'react';

/**
 * Organisation branding in the browser.
 *
 * Colours come from the organisation's settings. The API only stores exact #RRGGBB codes,
 * and we check again here before a colour touches any style, so a stored value can never
 * add other CSS to the page. Text colours are chosen automatically so that writing on a
 * branded background stays readable.
 */

export const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

export const PLATFORM_COLOURS = {
  primary: '#0B1F3A',
  secondary: '#F5EFE2',
  accent: '#1BA6A6',
} as const;

export interface BrandColours {
  primary: string;
  secondary: string;
  accent: string;
}

const DARK_TEXT = '#111827';
const LIGHT_TEXT = '#FFFFFF';

export function safeColour(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOUR.test(value) ? value.toUpperCase() : fallback;
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, from 1 (none) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever is easier to read on `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

/** Normal-size text needs a contrast of at least 4.5 (WCAG AA). */
export function isReadable(text: string, background: string): boolean {
  return contrastRatio(text, background) >= 4.5;
}

/**
 * CSS variables for a portal. Components use var(--brand-primary) and friends, so every
 * organisation's portal is the same code with different settings.
 */
export function brandStyle(colours: Partial<BrandColours> | null | undefined): CSSProperties {
  const primary = safeColour(colours?.primary, PLATFORM_COLOURS.primary);
  const secondary = safeColour(colours?.secondary, PLATFORM_COLOURS.secondary);
  const accent = safeColour(colours?.accent, PLATFORM_COLOURS.accent);
  // Links and headings sit on white: use the primary colour only if it is readable there.
  const ink = isReadable(primary, '#FFFFFF') ? primary : PLATFORM_COLOURS.primary;
  return {
    '--brand-primary': primary,
    '--brand-on-primary': readableTextOn(primary),
    '--brand-secondary': secondary,
    '--brand-on-secondary': readableTextOn(secondary),
    '--brand-accent': accent,
    '--brand-on-accent': readableTextOn(accent),
    '--brand-ink': ink,
  } as CSSProperties;
}

/** Plain-language warnings shown to administrators while they choose colours. */
export function colourWarnings(colours: BrandColours): string[] {
  const warnings: string[] = [];
  const primary = safeColour(colours.primary, PLATFORM_COLOURS.primary);
  const secondary = safeColour(colours.secondary, PLATFORM_COLOURS.secondary);
  if (!isReadable(readableTextOn(primary), primary)) {
    warnings.push('The primary colour is hard to read text on. Choose a darker or lighter shade.');
  }
  if (!isReadable(primary, '#FFFFFF')) {
    warnings.push(
      'The primary colour is too light for links on a white page, so links will use dark navy instead.',
    );
  }
  if (!isReadable(readableTextOn(secondary), secondary)) {
    warnings.push('The secondary colour is hard to read text on.');
  }
  return warnings;
}

/** First letters of the first two words, for a logo placeholder ("Sample Netball Club" → "SN"). */
export function initials(name: string): string {
  const letters = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.join('') || '?';
}
