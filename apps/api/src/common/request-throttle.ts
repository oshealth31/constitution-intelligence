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
 * Behind a proxy the real client address is only seen when TRUST_PROXY=true; otherwise every
 * request appears to come from the proxy and shares one budget.
 */
export interface RequestThrottleOptions {
  limit: number;
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
    const key = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > options.limit) {
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
