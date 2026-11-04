import { Inject, Injectable } from '@nestjs/common';
import { sessions, users, userTwoStep, type Database, type User } from '@constitution/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { generateToken, hashToken } from './tokens';

/** How often "last seen" is written, to avoid a database write on every request. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export interface ValidSession {
  sessionId: string;
  user: User;
  /** Two-step sign-in is turned on for this person (and this session passed it). */
  twoStepEnabled: boolean;
}

/**
 * Server-side sessions. The browser holds a random token in an HttpOnly cookie; the database
 * holds only its hash, so sessions can be revoked instantly (sign-out, password change,
 * account suspension) and a leaked database copy cannot be used to sign in.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * `twoStepVerified`: the person passed two-step sign-in for this session. Required for anyone
   * who has it turned on: validate() refuses their sessions without it.
   */
  async create(
    userId: string,
    meta: RequestMeta,
    options: { twoStepVerified?: boolean } = {},
  ): Promise<CreatedSession> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_ABSOLUTE_HOURS * 3_600_000);
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        twoStepVerifiedAt: options.twoStepVerified ? new Date() : null,
      })
      .returning({ id: sessions.id });
    if (!row) {
      throw new Error('Session could not be created');
    }
    return { sessionId: row.id, token, expiresAt };
  }

  /** Returns the session and its user, or null if the token is unknown, expired, revoked or the user is not active. */
  async validate(token: string): Promise<ValidSession | null> {
    const [row] = await this.db
      .select({ session: sessions, user: users, twoStepEnabledAt: userTwoStep.enabledAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .leftJoin(userTwoStep, eq(userTwoStep.userId, users.id))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    if (!row) {
      return null;
    }
    const { session, user } = row;
    const twoStepEnabled = row.twoStepEnabledAt !== null;
    const now = Date.now();
    // Super Admin sessions are shorter: they can affect every organisation.
    const idleLimit =
      (user.isPlatformSuperAdmin
        ? Math.min(this.config.SUPER_ADMIN_SESSION_IDLE_MINUTES, this.config.SESSION_IDLE_MINUTES)
        : this.config.SESSION_IDLE_MINUTES) * 60_000;
    const superAdminExpired =
      user.isPlatformSuperAdmin &&
      now - session.createdAt.getTime() >
        this.config.SUPER_ADMIN_SESSION_ABSOLUTE_HOURS * 3_600_000;
    if (
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      now - session.lastSeenAt.getTime() > idleLimit ||
      superAdminExpired ||
      user.status !== 'active' ||
      // Defence in depth: a session that never passed the second step is useless once it is on.
      (twoStepEnabled && session.twoStepVerifiedAt === null)
    ) {
      return null;
    }
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: new Date(now) })
        .where(eq(sessions.id, session.id));
    }
    return { sessionId: session.id, user, twoStepEnabled };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Signs the user out everywhere (optionally keeping the current session). Returns how many were revoked. */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (exceptSessionId) {
      conditions.push(ne(sessions.id, exceptSessionId));
    }
    const revoked = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return revoked.length;
  }
}
