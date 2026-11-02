import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { passwordResetTokens, users, type Database } from '@constitution/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService, type CreatedSession } from './session.service';
import { generateToken, hashToken } from './tokens';
import { UsersService, toPublicUser, type PublicUser } from './users.service';

export const INVALID_CREDENTIALS = 'Invalid email or password.';
export const TOO_MANY_ATTEMPTS = 'Too many attempts. Please wait a few minutes and try again.';
export const INVALID_RESET_LINK = 'This password reset link is invalid or has expired.';

const RESET_MAX_PER_EMAIL = 3;
const RESET_MAX_PER_IP = 20;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly usersService: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private get windowSeconds(): number {
    return this.config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60;
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ session: CreatedSession; user: PublicUser }> {
    const emailKey = `login:email:${hashToken(email)}`;
    const ipKey = `login:ip:${meta.ipAddress ?? 'unknown'}`;
    const [emailAttempts, ipAttempts] = await Promise.all([
      this.rateLimits.hit(emailKey, this.windowSeconds),
      this.rateLimits.hit(ipKey, this.windowSeconds),
    ]);
    if (
      emailAttempts > this.config.LOGIN_MAX_ATTEMPTS_PER_EMAIL ||
      ipAttempts > this.config.LOGIN_MAX_ATTEMPTS_PER_IP
    ) {
      await this.audit.record({
        action: 'auth.login.rate_limited',
        outcome: 'denied',
        targetType: 'email',
        targetId: email,
        meta,
      });
      throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.usersService.findByEmail(email);
    const passwordOk = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !passwordOk) {
      await this.audit.record({
        action: 'auth.login.failed',
        outcome: 'failure',
        actorUserId: user?.id ?? null,
        targetType: 'email',
        targetId: email,
        metadata: { reason: user ? 'wrong_password' : 'unknown_account' },
        meta,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status !== 'active') {
      await this.audit.record({
        action: 'auth.login.failed',
        outcome: 'denied',
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
        metadata: { reason: `account_${user.status}` },
        meta,
      });
      throw new ForbiddenException(
        'This account is not active. Please contact your administrator.',
      );
    }

    await this.rateLimits.reset(emailKey);
    const session = await this.sessions.create(user.id, meta);
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await this.audit.record({
      action: 'auth.login.succeeded',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'session',
      targetId: session.sessionId,
      meta,
    });
    return { session, user: toPublicUser(user) };
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      outcome: 'success',
      actorUserId: userId,
      targetType: 'session',
      targetId: sessionId,
      meta,
    });
  }

  async logoutEverywhere(userId: string, meta: RequestMeta): Promise<number> {
    const revoked = await this.sessions.revokeAllForUser(userId, 'logout_all');
    await this.audit.record({
      action: 'auth.logout_all',
      outcome: 'success',
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { sessionsRevoked: revoked },
      meta,
    });
    return revoked;
  }

  /**
   * Starts a password reset. Always behaves the same whether or not the email has an account,
   * so the response never reveals who is registered.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
    const [emailAttempts, ipAttempts] = await Promise.all([
      this.rateLimits.hit(`reset:email:${hashToken(email)}`, this.windowSeconds),
      this.rateLimits.hit(`reset:ip:${meta.ipAddress ?? 'unknown'}`, this.windowSeconds),
    ]);
    if (emailAttempts > RESET_MAX_PER_EMAIL || ipAttempts > RESET_MAX_PER_IP) {
      await this.audit.record({
        action: 'auth.password.reset_rate_limited',
        outcome: 'denied',
        targetType: 'email',
        targetId: email,
        meta,
      });
      return;
    }

    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== 'active') {
      await this.audit.record({
        action: 'auth.password.reset_requested',
        outcome: 'failure',
        targetType: 'email',
        targetId: email,
        metadata: { reason: user ? `account_${user.status}` : 'unknown_account' },
        meta,
      });
      return;
    }

    const link = await this.issuePasswordResetLink(user.id);
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Constitution Intelligence password',
      text:
        `Hello ${user.displayName},\n\n` +
        `Use this link to choose a new password. It expires in ${this.config.PASSWORD_RESET_TTL_MINUTES} minutes ` +
        `and can be used once:\n\n${link}\n\n` +
        'If you did not ask for this, you can ignore this email; your password will not change.',
    });
    await this.audit.record({
      action: 'auth.password.reset_requested',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      meta,
    });
  }

  /** Creates a one-time reset link (also used to let a new super admin set a first password). */
  async issuePasswordResetLink(userId: string): Promise<string> {
    const token = generateToken();
    await this.db.insert(passwordResetTokens).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.config.PASSWORD_RESET_TTL_MINUTES * 60_000),
    });
    return `${this.config.WEB_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .select({ tokenId: passwordResetTokens.id, user: users })
      .from(passwordResetTokens)
      .innerJoin(users, eq(passwordResetTokens.userId, users.id))
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row || row.user.status !== 'active') {
      await this.audit.record({
        action: 'auth.password.reset_failed',
        outcome: 'failure',
        actorUserId: row?.user.id ?? null,
        metadata: { reason: row ? `account_${row.user.status}` : 'invalid_or_expired_token' },
        meta,
      });
      throw new BadRequestException(INVALID_RESET_LINK);
    }

    const user = row.user;
    this.passwords.assertAcceptable(newPassword, {
      email: user.email,
      displayName: user.displayName,
    });
    const passwordHash = await this.passwords.hash(newPassword);

    await this.db.transaction(async (tx) => {
      // Claim the token first; a second concurrent use finds nothing to claim.
      const claimed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.id, row.tokenId), isNull(passwordResetTokens.usedAt)))
        .returning({ id: passwordResetTokens.id });
      if (claimed.length === 0) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      // Any other outstanding reset links for this user stop working too.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
        .where(eq(users.id, user.id));
    });

    const revoked = await this.sessions.revokeAllForUser(user.id, 'password_reset');
    await this.audit.record({
      action: 'auth.password.reset_completed',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { sessionsRevoked: revoked },
      meta,
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.audit.record({
        action: 'auth.password.change_failed',
        outcome: 'failure',
        actorUserId: userId,
        targetType: 'user',
        targetId: userId,
        metadata: { reason: 'wrong_current_password' },
        meta,
      });
      throw new BadRequestException('Your current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must be different from the current one.');
    }
    this.passwords.assertAcceptable(newPassword, {
      email: user.email,
      displayName: user.displayName,
    });
    const now = new Date();
    await this.db
      .update(users)
      .set({
        passwordHash: await this.passwords.hash(newPassword),
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    const revoked = await this.sessions.revokeAllForUser(
      userId,
      'password_changed',
      currentSessionId,
    );
    await this.audit.record({
      action: 'auth.password.changed',
      outcome: 'success',
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { otherSessionsRevoked: revoked },
      meta,
    });
  }
}
