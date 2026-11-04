import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { auditEvents, type Database } from '@constitution/db';
import { sql } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';

/** Finished sign-in records are kept this long after they end (for investigating incidents). */
export const KEEP_ENDED_SESSIONS_DAYS = 30;
/** First run after the API starts, so it does not compete with start-up. */
const FIRST_RUN_DELAY_MS = 5 * 60_000;
/** Any number: the same lock id in every copy of the API, so only one cleans at a time. */
const CLEANUP_LOCK_ID = 7_341_206;

export interface CleanupResult {
  ran: boolean;
  sessions: number;
  passwordResetLinks: number;
  rateLimitCounters: number;
  twoStepChallenges: number;
}

/**
 * Removes sign-in housekeeping rows nobody needs any more (Task D6):
 *   - sessions that ended (expired, signed out, timed out) more than 30 days ago;
 *   - password-reset links that expired or were used more than 30 days ago;
 *   - rate-limit counters whose window started more than a day ago (windows are minutes long);
 *   - two-step sign-in challenges that expired more than a day ago.
 * It never touches organisation data, invitations, accounts or the audit log, and records one
 * audit event with the counts. Runs every CLEANUP_INTERVAL_HOURS inside the API (0 = off), and
 * on demand with `node dist/cli/cleanup.js`. A database lock keeps two copies of the API from
 * running it at the same moment; running it again is always safe.
 */
@Injectable()
export class CleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(CleanupService.name) private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    const hours = this.config.CLEANUP_INTERVAL_HOURS;
    if (hours <= 0) return;
    const schedule = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.run()
          .catch((error: unknown) => this.logger.error({ err: error }, 'Cleanup failed'))
          .finally(() => schedule(hours * 3_600_000));
      }, delay);
      this.timer.unref(); // never keeps the process alive on its own
    };
    schedule(FIRST_RUN_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async run(now: Date = new Date()): Promise<CleanupResult> {
    const result = await this.db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_ID}) AS locked`,
      );
      if (!(lock.rows[0] as { locked: boolean }).locked) {
        return { ran: false, sessions: 0, passwordResetLinks: 0, rateLimitCounters: 0, twoStepChallenges: 0 };
      }
      const keep = new Date(now.getTime() - KEEP_ENDED_SESSIONS_DAYS * 86_400_000).toISOString();
      const day = new Date(now.getTime() - 86_400_000).toISOString();
      // A session also ends when it is idle for longer than the idle limit.
      const idle = new Date(
        now.getTime() -
          KEEP_ENDED_SESSIONS_DAYS * 86_400_000 -
          this.config.SESSION_IDLE_MINUTES * 60_000,
      ).toISOString();
      const sessions = await tx.execute(sql`
        DELETE FROM sessions
        WHERE expires_at < ${keep}::timestamptz
           OR revoked_at < ${keep}::timestamptz
           OR last_seen_at < ${idle}::timestamptz`);
      const resets = await tx.execute(sql`
        DELETE FROM password_reset_tokens
        WHERE expires_at < ${keep}::timestamptz OR used_at < ${keep}::timestamptz`);
      const counters = await tx.execute(sql`
        DELETE FROM auth_rate_limits WHERE window_started_at < ${day}::timestamptz`);
      const challenges = await tx.execute(sql`
        DELETE FROM two_step_challenges WHERE expires_at < ${day}::timestamptz`);
      const counts = {
        ran: true,
        sessions: sessions.rowCount ?? 0,
        passwordResetLinks: resets.rowCount ?? 0,
        rateLimitCounters: counters.rowCount ?? 0,
        twoStepChallenges: challenges.rowCount ?? 0,
      };
      await tx.insert(auditEvents).values({
        action: 'maintenance.cleanup',
        outcome: 'success',
        targetType: 'platform',
        metadata: {
          sessions: counts.sessions,
          passwordResetLinks: counts.passwordResetLinks,
          rateLimitCounters: counts.rateLimitCounters,
          twoStepChallenges: counts.twoStepChallenges,
        },
      });
      return counts;
    });
    if (result.ran) this.logger.info(result, 'Cleanup finished');
    return result;
  }
}
