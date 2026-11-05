import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * A coarse safety net against bots and floods: at most `limit` requests per minute from one
 * network address, counted in memory by this copy of the API.
 *
 * It does not replace the targeted limits (sign-in, password reset, AI, uploads, invitations),
 * which are stored in the database and hold across every copy of the API. With several copies
 * behind a load balancer each copy counts separately, and a large distributed attack needs
 * protection in front of the API (hosting provider or firewall). See docs/security/security-review.md.
 *
 * Behind a proxy the real client address is only seen when TRUST_PROXY matches the number of proxies; otherwise every
 * request appears to come from the proxy and shares one budget.
 *
 * Shared networks (task T3): many members can share ONE address (a church's Wi-Fi, a mobile
 * network). So a request carrying a session cookie is counted against that session's own
 * budget (`limit`), and every request from an address also counts towards a larger cap for the
 * whole address (`addressLimit`), which still stops a flood (including one using made-up
 * cookies). Requests without a session cookie share the address's `limit`.
 */
export interface RequestThrottleOptions {
  /** Per signed-in session, and per address for requests without a session. */
  limit: number;
  /** All requests from one address together (defaults to `limit`). */
  addressLimit?: number;
  /** Names of the session cookies (a request with one is counted per session). */
  sessionCookies?: string[];
  windowMs?: number;
  /** Requests whose path starts with one of these are never counted (health checks). */
  skipPrefixes?: string[];
  now?: () => number;
}

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please wait a minute and try again.';

export function createRequestThrottle(options: RequestThrottleOptions) {
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const skip = options.skipPrefixes ?? [];
  let windowStart = now();
  let counts = new Map<string, number>();

  return function requestThrottle(request: Request, response: Response, next: NextFunction) {
    const path = request.path ?? request.url ?? '';
    if (skip.some((prefix) => path.startsWith(prefix))) {
      next();
      return;
    }
    const current = now();
    if (current - windowStart >= windowMs) {
      // A new window: forget every address (keeps memory bounded).
      windowStart = current;
      counts = new Map();
    }
    const address = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const session = sessionOf(request.headers?.cookie, options.sessionCookies ?? []);
    const key = session ? `session:${session}` : `address:${address}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const addressKey = `all:${address}`;
    const addressCount = (counts.get(addressKey) ?? 0) + 1;
    counts.set(addressKey, addressCount);
    if (count > options.limit || addressCount > (options.addressLimit ?? options.limit)) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - current) / 1000));
      response
        .status(429)
        .set({ 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' })
        .json({
          error: {
            statusCode: 429,
            code: 'TOO_MANY_REQUESTS',
            message: RATE_LIMITED_MESSAGE,
            reason: 'RATE_LIMITED',
          },
        });
      return;
    }
    next();
  };
}

/** A short fingerprint of the session cookie's value (the token itself is not kept). */
function sessionOf(cookieHeader: string | undefined, names: string[]): string | null {
  if (!cookieHeader || names.length === 0) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (value && names.includes(name)) {
      return createHash('sha256').update(value).digest('base64url').slice(0, 22);
    }
  }
  return null;
}
