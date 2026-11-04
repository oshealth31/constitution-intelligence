import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import { pathOnly } from '../logging/path-only';
import { maskEmail } from '../modules/auth/auth.service';
import { sessionCookieName } from '../modules/auth/session-cookie';
import { createRequestThrottle } from './request-throttle';

function fakeExchange(ip: string, path = '/api/v1/search') {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(values: Record<string, string>) {
      Object.assign(this.headers, values);
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return { request: { ip, path } as never, response: response as never, raw: response };
}

describe('createRequestThrottle', () => {
  it('allows up to the limit per address, then answers 429 until the window ends', () => {
    let now = 0;
    const throttle = createRequestThrottle({ limit: 3, windowMs: 60_000, now: () => now });
    const next = vi.fn();
    for (let index = 0; index < 3; index += 1) {
      const { request, response } = fakeExchange('10.0.0.1');
      throttle(request, response, next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    const blocked = fakeExchange('10.0.0.1');
    throttle(blocked.request, blocked.response, next);
    expect(blocked.raw.statusCode).toBe(429);
    expect(blocked.raw.headers['Retry-After']).toBe('60');

    // Another address has its own budget.
    const other = fakeExchange('10.0.0.2');
    throttle(other.request, other.response, next);
    expect(next).toHaveBeenCalledTimes(4);

    // A new window starts afresh.
    now = 60_000;
    const later = fakeExchange('10.0.0.1');
    throttle(later.request, later.response, next);
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('never counts the skipped paths', () => {
    const throttle = createRequestThrottle({ limit: 1, skipPrefixes: ['/api/v1/health/'] });
    const next = vi.fn();
    for (let index = 0; index < 5; index += 1) {
      const { request, response } = fakeExchange('10.0.0.3', '/api/v1/health/ready');
      throttle(request, response, next);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });
});

describe('log and audit privacy helpers', () => {
  it('drops query strings from logged addresses', () => {
    expect(pathOnly('/api/v1/organisations/x/search?q=my+private+question')).toBe(
      '/api/v1/organisations/x/search',
    );
    expect(pathOnly('/api/v1/health/live')).toBe('/api/v1/health/live');
  });

  it('masks email addresses', () => {
    expect(maskEmail('someone@example.com')).toBe('s***@example.com');
    expect(maskEmail('my secret password')).toBe('***');
  });
});

describe('session cookie name', () => {
  it('uses the __Host- prefix once deployed', () => {
    const local = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost/db' });
    const production = loadConfig({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db.internal/db',
      DATABASE_SSL: 'true',
      CORS_ORIGINS: 'https://app.example.com',
      WEB_BASE_URL: 'https://app.example.com',
      MAIL_TRANSPORT: 'disabled',
      STORAGE_LOCAL_DIR: '/var/lib/constitution/storage',
    });
    expect(sessionCookieName(local)).toBe('ci_session');
    expect(sessionCookieName(production)).toBe('__Host-ci_session');
  });
});
