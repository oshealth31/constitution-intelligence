import type { CookieOptions, Request, Response } from 'express';
import { isDeployedEnvironment, type AppConfig } from '../../config/config';

/** Name of the session cookie. Its value is a random token; only its hash is stored. */
export const SESSION_COOKIE = 'ci_session';

function cookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true, // not readable by JavaScript, so scripts cannot steal it
    secure: isDeployedEnvironment(config), // HTTPS only outside local development and tests
    sameSite: 'lax', // not sent with cross-site form posts
    path: '/',
  };
}

export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}

export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  config: AppConfig,
): void {
  response.cookie(SESSION_COOKIE, token, { ...cookieOptions(config), expires: expiresAt });
}

export function clearSessionCookie(response: Response, config: AppConfig): void {
  response.clearCookie(SESSION_COOKIE, cookieOptions(config));
}
