import type { CookieOptions, Request, Response } from 'express';
import { isDeployedEnvironment, type AppConfig } from '../../config/config';

/** Name of the session cookie. Its value is a random token; only its hash is stored. */
export const SESSION_COOKIE = 'ci_session';
/**
 * Name used in staging and production. Browsers only accept a "__Host-" cookie if it is
 * Secure, set by the site itself and not shared with sub-domains, so it cannot be planted
 * or overwritten from another sub-domain.
 */
export const SECURE_SESSION_COOKIE = '__Host-ci_session';

export function sessionCookieName(config?: AppConfig): string {
  return config && isDeployedEnvironment(config) ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

function cookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true, // not readable by JavaScript, so scripts cannot steal it
    secure: isDeployedEnvironment(config), // HTTPS only outside local development and tests
    sameSite: 'lax', // not sent with cross-site form posts
    path: '/',
  };
}

export function readSessionToken(request: Request, config?: AppConfig): string | undefined {
  const name = sessionCookieName(config);
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
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
  response.cookie(sessionCookieName(config), token, { ...cookieOptions(config), expires: expiresAt });
}

export function clearSessionCookie(response: Response, config: AppConfig): void {
  response.clearCookie(sessionCookieName(config), cookieOptions(config));
}
