import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig, resolveSecretFiles } from './config';

const LOCAL_DB = 'postgresql://user:local@localhost:5432/constitution_dev';

function problemsFor(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies safe local defaults when only DATABASE_URL is provided', () => {
    const config = loadConfig({ DATABASE_URL: LOCAL_DB });

    expect(config.NODE_ENV).toBe('development');
    expect(config.APP_ENV).toBe('local');
    expect(config.API_HOST).toBe('127.0.0.1');
    expect(config.API_PORT).toBe(4000);
    expect(config.DATABASE_SSL).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to start without a database URL', () => {
    expect(problemsFor({})).toContain('DATABASE_URL is required');
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(problemsFor({ DATABASE_URL: 'mysql://localhost/db' })).toContain(
      'DATABASE_URL must start with postgres:// or postgresql://',
    );
  });

  it('rejects invalid numbers and booleans', () => {
    const problems = problemsFor({
      DATABASE_URL: LOCAL_DB,
      API_PORT: '99999',
      DATABASE_SSL: 'yes',
    });
    expect(problems.some((p) => p.startsWith('API_PORT'))).toBe(true);
    expect(problems).toContain('DATABASE_SSL must be "true" or "false"');
  });

  it('parses a comma-separated list of CORS origins', () => {
    const config = loadConfig({
      DATABASE_URL: LOCAL_DB,
      CORS_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000 ,',
    });
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('enforces production safety rules', () => {
    const problems = problemsFor({
      NODE_ENV: 'development',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:x@db.internal:5432/app',
      DATABASE_SSL: 'false',
      LOG_PRETTY: 'true',
      CORS_ORIGINS: 'http://insecure.example',
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        'NODE_ENV must be "production" when APP_ENV is "production"',
        'DATABASE_SSL must be true in staging and production',
        'LOG_PRETTY must be false in staging and production (structured JSON logs only)',
        'CORS_ORIGINS must use https:// origins in staging and production',
        'MAIL_TRANSPORT must not be "log" in staging and production (emails contain one-time links)',
        'WEB_BASE_URL must use https:// in staging and production',
        'MFA_ENCRYPTION_KEY is required in staging and production (it protects two-step sign-in secrets); give it as MFA_ENCRYPTION_KEY_FILE',
      ]),
    );
  });

  it('accepts only a 32-byte hexadecimal two-step key, and reads it from a file', () => {
    expect(problemsFor({ DATABASE_URL: LOCAL_DB, MFA_ENCRYPTION_KEY: 'too-short' })).toEqual([
      'MFA_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)',
    ]);
    const env = resolveSecretFiles(
      { MFA_ENCRYPTION_KEY_FILE: '/run/secrets/mfa' },
      () => 'cd'.repeat(32) + '\n',
    );
    expect(env.MFA_ENCRYPTION_KEY).toBe('cd'.repeat(32));
  });

  it('applies secure authentication defaults', () => {
    const config = loadConfig({ DATABASE_URL: LOCAL_DB });
    expect(config.LOGIN_MAX_ATTEMPTS_PER_EMAIL).toBe(5);
    expect(config.AUTH_RATE_LIMIT_WINDOW_MINUTES).toBe(15);
    expect(config.PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(config.SESSION_IDLE_MINUTES).toBe(1440);
    expect(config.WEB_BASE_URL).toBe('http://localhost:3000');
  });

  it('accepts a correctly configured production environment', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      API_HOST: '0.0.0.0',
      DATABASE_URL: 'postgresql://user:x@db.internal:5432/app',
      DATABASE_SSL: 'true',
      LOG_PRETTY: 'false',
      CORS_ORIGINS: 'https://admin.example.com,https://example.com',
      WEB_BASE_URL: 'https://app.example.com',
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp-relay.example.com',
      SMTP_USER: 'apikey-user',
      SMTP_PASSWORD: 'not-a-real-password',
      MAIL_FROM: 'Constitution Intelligence <no-reply@example.com>',
      STORAGE_LOCAL_DIR: '/var/lib/constitution/storage',
      MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
    });
    expect(config.DATABASE_SSL).toBe(true);
    expect(config.CORS_ORIGINS).toHaveLength(2);
  });

  it('refuses risky logging and storage settings in production', () => {
    const problems = problemsFor({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:x@db.internal:5432/app',
      LOG_LEVEL: 'debug',
      STORAGE_LOCAL_DIR: 'relative/storage',
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        'LOG_LEVEL must not be "debug" or "trace" in production (too much detail in the logs)',
        'STORAGE_LOCAL_DIR must be an absolute path in staging and production',
      ]),
    );
  });

  it('applies secure abuse-protection and super-admin session defaults', () => {
    const config = loadConfig({ DATABASE_URL: LOCAL_DB });
    expect(config.API_RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(config.SUPER_ADMIN_SESSION_IDLE_MINUTES).toBe(30);
    expect(config.SUPER_ADMIN_SESSION_ABSOLUTE_HOURS).toBe(12);
  });

  it('never includes setting values in error messages', () => {
    const secretLookingValue = 'mysql://admin:SuperSecret123@host/db';
    const error = (() => {
      try {
        loadConfig({ DATABASE_URL: secretLookingValue });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error?.message).not.toContain('SuperSecret123');
  });

  it('reads TRUST_PROXY as a number of proxies', () => {
    expect(loadConfig({ DATABASE_URL: LOCAL_DB }).TRUST_PROXY).toBe(0);
    expect(loadConfig({ DATABASE_URL: LOCAL_DB, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ DATABASE_URL: LOCAL_DB, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(problemsFor({ DATABASE_URL: LOCAL_DB, TRUST_PROXY: 'yes' })).toEqual([
      'TRUST_PROXY must be "true", "false" or a number of proxies (0-9)',
    ]);
  });

  describe('email settings', () => {
    it('requires the SMTP server, account, password and sender for "smtp"', () => {
      expect(problemsFor({ DATABASE_URL: LOCAL_DB, MAIL_TRANSPORT: 'smtp' })).toEqual(
        expect.arrayContaining([
          'SMTP_HOST is required when MAIL_TRANSPORT is "smtp"',
          'SMTP_USER is required when MAIL_TRANSPORT is "smtp"',
          'SMTP_PASSWORD is required when MAIL_TRANSPORT is "smtp"',
          'MAIL_FROM is required when MAIL_TRANSPORT is "smtp"',
        ]),
      );
    });

    it('defaults to STARTTLS on port 587 and offers no unencrypted mode', () => {
      const config = loadConfig({
        DATABASE_URL: LOCAL_DB,
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'secret',
        MAIL_FROM: 'no-reply@example.com',
      });
      expect(config.SMTP_PORT).toBe(587);
      expect(config.SMTP_SECURITY).toBe('starttls');
      expect(problemsFor({ DATABASE_URL: LOCAL_DB, SMTP_SECURITY: 'none' })).toHaveLength(1);
    });

    it('refuses a sender that is not an email address, or that could add lines', () => {
      for (const sender of ['Constitution Intelligence', 'a <b@c.d', 'x\nBcc: <a@b.co>']) {
        expect(problemsFor({ DATABASE_URL: LOCAL_DB, MAIL_FROM: sender })).toEqual([
          'MAIL_FROM must be an email address, optionally with a name: Name <address@domain>',
        ]);
      }
    });

    it('requires real email in production', () => {
      expect(
        problemsFor({
          NODE_ENV: 'production',
          APP_ENV: 'production',
          DATABASE_URL: 'postgresql://user:x@db.internal:5432/app',
          MAIL_TRANSPORT: 'disabled',
        }),
      ).toEqual(
        expect.arrayContaining([
          'MAIL_TRANSPORT must be "smtp" in production (invitations and password resets are sent by email)',
        ]),
      );
    });

    it('reads the SMTP password from a file', () => {
      const env = resolveSecretFiles(
        { SMTP_PASSWORD_FILE: '/run/secrets/smtp_password' },
        () => 'k3y\n',
      );
      expect(env.SMTP_PASSWORD).toBe('k3y');
    });
  });

  describe('secrets from files', () => {
    it('reads DATABASE_URL from the file named by DATABASE_URL_FILE', () => {
      const env = resolveSecretFiles({ DATABASE_URL_FILE: '/run/secrets/database_url' }, (path) =>
        path === '/run/secrets/database_url' ? 'postgresql://app:s3cret@db/app\n' : '',
      );
      expect(env.DATABASE_URL).toBe('postgresql://app:s3cret@db/app');
      expect(env.DATABASE_URL_FILE).toBeUndefined();
    });

    it('refuses both forms at once, and unreadable files, without showing values', () => {
      expect(() =>
        resolveSecretFiles({ DATABASE_URL: 'postgresql://a@b/c', DATABASE_URL_FILE: '/x' }),
      ).toThrow(/DATABASE_URL and DATABASE_URL_FILE are both set/);
      const error = (() => {
        try {
          resolveSecretFiles({ ANTHROPIC_API_KEY_FILE: '/no/such/file' }, () => {
            throw new Error('ENOENT /no/such/file');
          });
        } catch (caught) {
          return caught as Error;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error?.message).toContain(
        'ANTHROPIC_API_KEY_FILE points to a file that cannot be read',
      );
      expect(error?.message).not.toContain('/no/such/file');
    });
  });
});
