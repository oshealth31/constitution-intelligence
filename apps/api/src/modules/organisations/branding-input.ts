import { isReservedSlug, SLUG_PATTERN } from '@constitution/shared';
import { z } from 'zod';

/**
 * Validation for organisation branding. Used by both the organisation's own administrators
 * and the platform control centre, so the rules are identical everywhere.
 *
 * Safety rules:
 * - colours must be exact 6-digit hex codes (no CSS keywords, functions or URLs), so a colour
 *   can never smuggle extra CSS into a page;
 * - text fields are plain text: invisible control characters are refused and the portal always
 *   displays the text as text, never as HTML;
 * - logos are checked by their actual bytes, not their name or declared type (see detectImageType).
 */

export const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;
// Control characters other than tab/new line/carriage return.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LINE_BREAKS = /[\r\n\t]/;

export const colourSchema = z
  .string()
  .regex(HEX_COLOUR, { error: 'must be a colour like #0B1F3A' })
  .transform((value) => value.toUpperCase());

function plainText(max: number, options: { multiline: boolean }) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .refine((value) => value.length <= max, { error: `must be at most ${max} characters` })
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      error: 'must not contain hidden control characters',
    })
    .refine((value) => options.multiline || !LINE_BREAKS.test(value), {
      error: 'must be a single line',
    });
}

/** Empty text means "clear this setting". */
const optionalText = (max: number, multiline = false) =>
  plainText(max, { multiline })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// Unknown fields (for example an "organisationId") are discarded: the organisation always
// comes from the verified membership (or, for the platform, from the URL checked by the guard).
export const brandingChangeSchema = z
  .object({
    displayName: optionalText(200),
    tagline: optionalText(300),
    welcomeMessage: optionalText(1000, true),
    primaryColour: colourSchema.optional(),
    secondaryColour: colourSchema.optional(),
    accentColour: colourSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Provide at least one field.',
  });

export type BrandingChange = z.output<typeof brandingChangeSchema>;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, { error: 'must be 3-50 lower-case letters, numbers or hyphens' })
  .refine((value) => !isReservedSlug(value), {
    error: 'is reserved by the platform; please choose another address',
  });

// ----- Logos ---------------------------------------------------------------------------------

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const logoUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .transform((value) => value.replace(/[^A-Za-z0-9._ -]/g, '_')),
  // Base64 of at most LOGO_MAX_BYTES bytes (4 characters per 3 bytes).
  dataBase64: z
    .string()
    .min(8)
    .max(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4, { error: 'the logo must be 512 KB or smaller' })
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: 'must be base64 data' }),
});

/**
 * Identifies an image from its first bytes ("magic numbers"). Only PNG, JPEG and WebP are
 * recognised. SVG is deliberately NOT accepted: SVG files can contain scripts.
 * Returns null for anything else, whatever the file is called.
 */
export function detectImageType(content: Buffer): LogoType | null {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('latin1') === 'RIFF' &&
    content.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
