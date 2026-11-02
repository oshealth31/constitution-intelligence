import { z } from 'zod';

/**
 * All API settings come from environment variables and are validated here at startup.
 * If anything is missing or unsafe, the API refuses to start and lists the problems
 * (names only, never values).
 */

const booleanString = z
  .enum(['true', 'false', '1', '0'], {
    errorMap: () => ({ message: 'must be "true" or "false"' }),
  })
  .transform((value) => value === 'true' || value === '1');

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    APP_VERSION: z.string().min(1).default('0.1.0'),

    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    TRUST_PROXY: booleanString.default('false'),

    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    LOG_PRETTY: booleanString.default('false'),

    DATABASE_URL: z
      .string({ required_error: 'is required' })
      .min(1, 'is required')
      .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
        message: 'must start with postgres:// or postgresql://',
      }),
    DATABASE_SSL: booleanString.default('false'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((config, ctx) => {
    const deployed = config.APP_ENV === 'staging' || config.APP_ENV === 'production';

    if (config.APP_ENV === 'production' && config.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NODE_ENV'],
        message: 'must be "production" when APP_ENV is "production"',
      });
    }
    if (!deployed) {
      return;
    }
    if (!config.DATABASE_SSL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_SSL'],
        message: 'must be true in staging and production',
      });
    }
    if (config.LOG_PRETTY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOG_PRETTY'],
        message: 'must be false in staging and production (structured JSON logs only)',
      });
    }
    if (config.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'must list the allowed web origins in staging and production',
      });
    }
    if (config.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'must use https:// origins in staging and production',
      });
    }
  });

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

export class ConfigValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Validates the given environment and returns a frozen, typed configuration object. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'config'} ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
}
