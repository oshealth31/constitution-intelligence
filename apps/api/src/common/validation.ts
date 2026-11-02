import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Validates untrusted input. Throws 400 with a list of problems (field names, never values). */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => {
        const field = issue.path.map(String).join('.');
        return field ? `${field}: ${issue.message}` : issue.message;
      }),
    );
  }
  return result.data;
}

/** Normalised email address: trimmed and lower-case. */
export const emailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.email({ error: 'must be a valid email address' }).max(254),
);

/** Upper bound protects the password hasher from very large inputs. Strength rules live in password-policy.ts. */
export const passwordInputSchema = z
  .string({ error: 'is required' })
  .min(1, { error: 'is required' })
  .max(128, { error: 'must be at most 128 characters' });

export const displayNameSchema = z
  .string({ error: 'is required' })
  .trim()
  .min(1, { error: 'is required' })
  .max(120, { error: 'must be at most 120 characters' });

export const uuidSchema = z.uuid();
