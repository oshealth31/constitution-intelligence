import { z } from 'zod';

/**
 * All API settings come from environment variables and are validated here at startup.
 * If anything is missing or unsafe, the API refuses to start and lists the problems
 * (names only, never values).
 */

/** A "true"/"false" setting. The default is applied before conversion to a boolean. */
const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'], { error: () => 'must be "true" or "false"' })
    .default(fallback)
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
    TRUST_PROXY: booleanString('false'),

    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    LOG_PRETTY: booleanString('false'),

    DATABASE_URL: z
      .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
      .min(1, { error: 'is required' })
      .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
        error: 'must start with postgres:// or postgresql://',
      }),
    DATABASE_SSL: booleanString('false'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // Address of the web app, used to build links in emails (password reset, invitations).
    WEB_BASE_URL: z
      .string()
      .url({ error: 'must be a full URL, e.g. http://localhost:3000' })
      .default('http://localhost:3000')
      .transform((value) => value.replace(/\/+$/, '')),

    // Sessions: signed-in users are signed out after this long without activity...
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(43_200).default(1_440),
    // ...and always after this long, even if active.
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(2_160).default(336),

    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1_440).default(30),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),

    // Brute-force protection for sign-in and password reset.
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
    LOGIN_MAX_ATTEMPTS_PER_EMAIL: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().min(1).max(10_000).default(50),

    // "log" writes emails to the server log (local development only).
    // "disabled" drops them. A real email provider is added in a later stage.
    MAIL_TRANSPORT: z.enum(['log', 'disabled']).default('log'),

    // Where uploaded files are kept. "local" = a folder on this computer (development and tests).
    // A cloud object-storage driver is added in the deployment stage.
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
    // Largest constitution document (PDF or DOCX) accepted for upload, in bytes. Default 10 MB.
    DOCUMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024)
      .default(10 * 1024 * 1024),

    // AI question answering.
    //   disabled  - no answers (the page says the service is not available)
    //   anthropic - Anthropic's Claude models; needs ANTHROPIC_API_KEY (kept on the server only)
    //   offline   - local development and tests only: no AI model; quotes the best-matching passage
    AI_PROVIDER: z.enum(['disabled', 'anthropic', 'offline']).default('disabled'),
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    AI_MODEL: z.string().min(3).max(100).default('claude-sonnet-5-5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    AI_MAX_QUESTIONS_PER_USER_PER_HOUR: z.coerce.number().int().min(1).max(1_000).default(30),
    // Days an organisation's data is kept, untouched, after its access becomes restricted
    // (subscription lapsed or cancelled and the grace period over). See docs/subscriptions.md.
    SUBSCRIPTION_DATA_RETENTION_DAYS: z.coerce.number().int().min(30).max(3_650).default(90),
    // How organisations should pay (for example bank details), shown on their billing page.
    // Not secret. When not set, the page says that Constitution Intelligence will send details.
    BILLING_PAYMENT_INSTRUCTIONS: z.string().trim().min(10).max(1_000).optional(),
  })
  .superRefine((config, ctx) => {
    if (config.AI_PROVIDER === 'anthropic' && !config.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'is required when AI_PROVIDER is "anthropic"',
      });
    }
    const deployed = config.APP_ENV === 'staging' || config.APP_ENV === 'production';

    if (config.APP_ENV === 'production' && config.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: 'must be "production" when APP_ENV is "production"',
      });
    }
    if (!deployed) {
      return;
    }
    if (!config.DATABASE_SSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_SSL'],
        message: 'must be true in staging and production',
      });
    }
    if (config.LOG_PRETTY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_PRETTY'],
        message: 'must be false in staging and production (structured JSON logs only)',
      });
    }
    if (config.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must list the allowed web origins in staging and production',
      });
    }
    if (config.AI_PROVIDER === 'offline') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'must not be "offline" in staging and production (it is not a real AI model)',
      });
    }
    if (config.MAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'must not be "log" in staging and production (emails contain one-time links)',
      });
    }
    if (!config.WEB_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_BASE_URL'],
        message: 'must use https:// in staging and production',
      });
    }
    if (config.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
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

/** True for staging and production: stricter security settings apply. */
export function isDeployedEnvironment(config: AppConfig): boolean {
  return config.APP_ENV === 'staging' || config.APP_ENV === 'production';
}
