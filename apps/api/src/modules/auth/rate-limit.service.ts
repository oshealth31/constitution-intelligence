import { Inject, Injectable } from '@nestjs/common';
import { authRateLimits, type Database } from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';

/**
 * Fixed-window attempt counters stored in PostgreSQL, so limits hold across
 * every running copy of the API and survive restarts.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Records one attempt for `key` and returns the number of attempts in the current window. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const result = await this.db.execute(sql`
      INSERT INTO auth_rate_limits (key, window_started_at, attempts)
      VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE
          WHEN auth_rate_limits.window_started_at < ${windowStart}::timestamptz THEN 1
          ELSE auth_rate_limits.attempts + 1
        END,
        window_started_at = CASE
          WHEN auth_rate_limits.window_started_at < ${windowStart}::timestamptz THEN now()
          ELSE auth_rate_limits.window_started_at
        END
      RETURNING attempts
    `);
    const row = result.rows[0] as { attempts?: number | string } | undefined;
    return Number(row?.attempts ?? 1);
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(authRateLimits).where(eq(authRateLimits.key, key));
  }
}
