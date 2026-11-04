import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './config';

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
      ]),
    );
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
      MAIL_TRANSPORT: 'disabled',
      STORAGE_LOCAL_DIR: '/var/lib/constitution/storage',
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
});
