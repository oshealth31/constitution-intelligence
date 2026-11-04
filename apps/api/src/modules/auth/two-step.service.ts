import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  memberships,
  organisations,
  sessions,
  twoStepChallenges,
  twoStepRecoveryCodes,
  userTwoStep,
  users,
  type Database,
  type User,
} from '@constitution/db';
import { and, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { oneLine, renderEmail } from '../mail/templates';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { generateToken, hashToken } from './tokens';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import {
  TwoStepCrypto,
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  twoStepMasterKey,
} from './two-step-crypto';

/** A sign-in waiting for its second step is valid for five minutes. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Wrong codes allowed on one waiting sign-in before it is abandoned. */
export const CHALLENGE_MAX_FAILURES = 5;
/** Wrong codes allowed per person in the sign-in rate-limit window, across all attempts. */
export const TWO_STEP_MAX_FAILURES_PER_WINDOW = 10;
export const ISSUER = 'Constitution Intelligence';

export const WRONG_CODE = 'That code is not right. Check your authenticator app and try again.';
export const CHALLENGE_EXPIRED = 'This sign-in has expired. Please sign in again.';
export const TOO_MANY_CODES =
  'Too many wrong codes. Please wait a few minutes, then sign in again.';

/** "123 456" and "123-456" are accepted as "123456". */
export function cleanCode(code: string): string {
  return code.replace(/[\s-]/g, '');
}

export interface TwoStepStatus {
  /** Two-step sign-in is turned on for this person. */
  enabled: boolean;
  /** It must be turned on (Platform Super Admins). */
  required: boolean;
  /** This person may turn it on (Super Admins, organisation Owners and Administrators). */
  available: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

export interface TwoStepSetup {
  secret: string;
  otpauthUrl: string;
  /** The QR code as an SVG data address, for an <img> tag. */
  qrCode: string;
}

export type SecondStep = { code: string } | { recoveryCode: string };

/**
 * Two-step sign-in: an authenticator-app code (TOTP) after the password.
 * Secrets are encrypted at rest, recovery codes are hashed, every change is audited and the
 * person is told by email when it is turned on or off, reset, or a recovery code is used.
 */
@Injectable()
export class TwoStepService {
  private readonly crypto: TwoStepCrypto;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rateLimits: RateLimitService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {
    this.crypto = new TwoStepCrypto(twoStepMasterKey(config));
  }

  private get windowSeconds(): number {
    return this.config.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60;
  }

  // ---------------------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------------------

  async isEnabled(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ enabledAt: userTwoStep.enabledAt })
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, userId))
      .limit(1);
    return Boolean(row?.enabledAt);
  }

  /** Super Admins and anyone who is an active Owner or Administrator of an active organisation. */
  async isAvailableTo(user: User): Promise<boolean> {
    if (user.isPlatformSuperAdmin) return true;
    const [row] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(organisations, eq(memberships.organisationId, organisations.id))
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.status, 'active'),
          eq(organisations.status, 'active'),
          inArray(memberships.role, ['owner', 'admin']),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async status(user: User): Promise<TwoStepStatus> {
    const [row] = await this.db
      .select()
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, user.id))
      .limit(1);
    const enabled = Boolean(row?.enabledAt);
    const [remaining] = enabled
      ? await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(twoStepRecoveryCodes)
          .where(and(eq(twoStepRecoveryCodes.userId, user.id), isNull(twoStepRecoveryCodes.usedAt)))
      : [{ count: 0 }];
    return {
      enabled,
      required: user.isPlatformSuperAdmin,
      available: enabled || (await this.isAvailableTo(user)),
      enabledAt: row?.enabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining?.count ?? 0,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Setting up
  // ---------------------------------------------------------------------------------------

  /** Starts (or restarts) setup: a new secret, shown once as a QR code and as text. */
  async beginSetup(user: User): Promise<TwoStepSetup> {
    if (!(await this.isAvailableTo(user))) {
      throw new ForbiddenException(
        'Two-step sign-in is available to organisation Owners and Administrators.',
      );
    }
    if (await this.isEnabled(user.id)) {
      throw new ConflictException('Two-step sign-in is already turned on for your account.');
    }
    const secret = generateTotpSecret();
    const ciphertext = this.crypto.encryptSecret(secret, user.id);
    await this.db
      .insert(userTwoStep)
      .values({ userId: user.id, secretCiphertext: ciphertext })
      .onConflictDoUpdate({
        target: userTwoStep.userId,
        set: { secretCiphertext: ciphertext, enabledAt: null, lastUsedStep: null, updatedAt: new Date() },
      });
    const address = otpauthUrl(secret, user.email, ISSUER);
    const svg = await QRCode.toString(address, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return {
      secret,
      otpauthUrl: address,
      qrCode: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    };
  }

  /**
   * Finishes setup once the first code from the app is right. Turns two-step sign-in on, marks
   * this session as verified, signs out every other session and returns ten recovery codes,
   * which are shown once and never again.
   */
  async confirmSetup(
    user: User,
    sessionId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    const [row] = await this.db
      .select()
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, user.id))
      .limit(1);
    if (!row || row.enabledAt) {
      throw new ConflictException(
        row ? 'Two-step sign-in is already turned on.' : 'Start setting up two-step sign-in first.',
      );
    }
    await this.limitFailures(user.id);
    const step = verifyTotp(
      this.crypto.decryptSecret(row.secretCiphertext, user.id),
      cleanCode(code),
    );
    if (step === null) {
      await this.recordFailure(user.id, 'setup', meta);
      throw new BadRequestException(WRONG_CODE);
    }
    const now = new Date();
    await this.db
      .update(userTwoStep)
      .set({ enabledAt: now, lastUsedStep: step, updatedAt: now })
      .where(eq(userTwoStep.userId, user.id));
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    await this.db
      .update(sessions)
      .set({ twoStepVerifiedAt: now })
      .where(eq(sessions.id, sessionId));
    const otherSessions = await this.sessions.revokeAllForUser(
      user.id,
      'two_step_enabled',
      sessionId,
    );
    await this.audit.record({
      action: 'auth.two_step.enabled',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { otherSessionsSignedOut: otherSessions },
      meta,
    });
    await this.notify(
      user,
      'Two-step sign-in is now on',
      [
        'Two-step sign-in was turned on for your Constitution Intelligence account. From now on you will be asked for a code from your authenticator app after your password.',
        'Keep your recovery codes somewhere safe. Each one can be used once if you lose your phone.',
      ],
      'If you did not do this, contact Constitution Intelligence support straight away.',
    );
    return { recoveryCodes };
  }

  /** Replaces the recovery codes (the old ones stop working). Needs a current code. */
  async newRecoveryCodes(
    user: User,
    code: string,
    meta: RequestMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.requireCurrentCode(user, code, meta);
    const recoveryCodes = await this.replaceRecoveryCodes(user.id);
    await this.audit.record({
      action: 'auth.two_step.recovery_codes_replaced',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      meta,
    });
    return { recoveryCodes };
  }

  /** Turns two-step sign-in off. Needs the password and a current code. Not for Super Admins. */
  async disable(user: User, password: string, code: string, meta: RequestMeta): Promise<void> {
    if (user.isPlatformSuperAdmin) {
      throw new ForbiddenException(
        'Two-step sign-in is required for Platform Super Admins and cannot be turned off.',
      );
    }
    await this.limitFailures(user.id);
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.recordFailure(user.id, 'disable_wrong_password', meta);
      throw new BadRequestException('Your password is not right.');
    }
    await this.requireCurrentCode(user, code, meta);
    await this.removeAll(user.id);
    await this.audit.record({
      action: 'auth.two_step.disabled',
      outcome: 'success',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      meta,
    });
    await this.notify(
      user,
      'Two-step sign-in has been turned off',
      [
        'Two-step sign-in was turned off for your Constitution Intelligence account. Signing in now needs only your password.',
      ],
      'If you did not do this, change your password and contact Constitution Intelligence support straight away.',
    );
  }

  // ---------------------------------------------------------------------------------------
  // Signing in
  // ---------------------------------------------------------------------------------------

  /** Called after a correct password for someone with two-step sign-in on. */
  async startChallenge(
    userId: string,
    meta: RequestMeta,
  ): Promise<{ challengeToken: string; expiresAt: Date }> {
    const challengeToken = generateToken();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    // Tidy up this person's finished or expired challenges.
    await this.db
      .delete(twoStepChallenges)
      .where(
        and(
          eq(twoStepChallenges.userId, userId),
          or(sql`${twoStepChallenges.usedAt} IS NOT NULL`, lt(twoStepChallenges.expiresAt, new Date())),
        ),
      );
    await this.db.insert(twoStepChallenges).values({
      userId,
      tokenHash: hashToken(challengeToken),
      expiresAt,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { challengeToken, expiresAt };
  }

  /**
   * Checks the second step of a sign-in. Returns the person and how they proved it; the caller
   * then creates the session. The waiting sign-in can be completed once only.
   */
  async completeChallenge(
    challengeToken: string,
    secondStep: SecondStep,
    meta: RequestMeta,
  ): Promise<{ user: User; method: 'code' | 'recovery_code' }> {
    const [challenge] = await this.db
      .select()
      .from(twoStepChallenges)
      .where(
        and(
          eq(twoStepChallenges.tokenHash, hashToken(challengeToken)),
          isNull(twoStepChallenges.usedAt),
          gt(twoStepChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!challenge || challenge.failedAttempts >= CHALLENGE_MAX_FAILURES) {
      throw new UnauthorizedException(CHALLENGE_EXPIRED);
    }
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1);
    const [settings] = await this.db
      .select()
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, challenge.userId))
      .limit(1);
    if (!user || user.status !== 'active' || !settings?.enabledAt) {
      throw new UnauthorizedException(CHALLENGE_EXPIRED);
    }
    await this.limitFailures(user.id);

    let method: 'code' | 'recovery_code' | null = null;
    if ('code' in secondStep) {
      if (await this.acceptCode(user.id, settings.secretCiphertext, settings.lastUsedStep, secondStep.code)) {
        method = 'code';
      }
    } else if (await this.useRecoveryCode(user.id, secondStep.recoveryCode)) {
      method = 'recovery_code';
    }

    if (method === null) {
      const [updated] = await this.db
        .update(twoStepChallenges)
        .set({ failedAttempts: sql`${twoStepChallenges.failedAttempts} + 1` })
        .where(eq(twoStepChallenges.id, challenge.id))
        .returning({ failedAttempts: twoStepChallenges.failedAttempts });
      await this.recordFailure(
        user.id,
        'code' in secondStep ? 'wrong_code' : 'wrong_recovery_code',
        meta,
      );
      if ((updated?.failedAttempts ?? CHALLENGE_MAX_FAILURES) >= CHALLENGE_MAX_FAILURES) {
        await this.db
          .update(twoStepChallenges)
          .set({ usedAt: new Date() })
          .where(eq(twoStepChallenges.id, challenge.id));
        throw new UnauthorizedException(TOO_MANY_CODES);
      }
      throw new UnauthorizedException(WRONG_CODE);
    }

    // Single use: only one request can claim the waiting sign-in.
    const claimed = await this.db
      .update(twoStepChallenges)
      .set({ usedAt: new Date() })
      .where(and(eq(twoStepChallenges.id, challenge.id), isNull(twoStepChallenges.usedAt)))
      .returning({ id: twoStepChallenges.id });
    if (claimed.length === 0) {
      throw new UnauthorizedException(CHALLENGE_EXPIRED);
    }
    await this.rateLimits.reset(this.failureKey(user.id));

    if (method === 'recovery_code') {
      const remaining = await this.remainingRecoveryCodes(user.id);
      await this.audit.record({
        action: 'auth.two_step.recovery_code_used',
        outcome: 'success',
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
        metadata: { recoveryCodesRemaining: remaining },
        meta,
      });
      await this.notify(
        user,
        'A recovery code was used to sign in',
        [
          'Someone signed in to your Constitution Intelligence account with one of your two-step recovery codes.',
          `You have ${remaining} unused recovery code${remaining === 1 ? '' : 's'} left. If you have lost your phone, set up two-step sign-in again on your new phone.`,
        ],
        'If this was not you, change your password and contact Constitution Intelligence support straight away.',
      );
    }
    return { user, method };
  }

  // ---------------------------------------------------------------------------------------
  // Reset (lost phone and no recovery codes)
  // ---------------------------------------------------------------------------------------

  /**
   * Removes someone's two-step sign-in and signs them out everywhere, so they can set it up
   * again. Done by another Super Admin (with a reason) or from the server command line.
   */
  async reset(
    email: string,
    actorUserId: string | null,
    reason: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; sessionsRevoked: number }> {
    const [target] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!target) {
      throw new NotFoundException('No account has that email address.');
    }
    if (actorUserId !== null && target.id === actorUserId) {
      throw new ForbiddenException(
        'You cannot reset your own two-step sign-in. Ask another Super Admin, or use a recovery code.',
      );
    }
    if (!(await this.hasAnything(target.id))) {
      throw new ConflictException('Two-step sign-in is not set up for this account.');
    }
    await this.removeAll(target.id);
    const sessionsRevoked = await this.sessions.revokeAllForUser(target.id, 'two_step_reset');
    await this.audit.record({
      action: 'auth.two_step.reset',
      outcome: 'success',
      actorUserId,
      targetType: 'user',
      targetId: target.id,
      metadata: { reason, sessionsRevoked, by: actorUserId ? 'super_admin' : 'command_line' },
      meta,
    });
    await this.notify(
      target,
      'Your two-step sign-in was reset',
      [
        'A Constitution Intelligence administrator reset two-step sign-in for your account, and you have been signed out on every device.',
        target.isPlatformSuperAdmin
          ? 'Sign in again and set up two-step sign-in on your phone before you use the Control Centre.'
          : 'Sign in again with your password. You can then set up two-step sign-in again on your profile page.',
      ],
      'If you did not ask for this, contact Constitution Intelligence support straight away.',
    );
    return { userId: target.id, sessionsRevoked };
  }

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  private failureKey(userId: string): string {
    return `two-step:user:${userId}`;
  }

  /** Refuses (429) once too many wrong codes were tried for this person in the window. */
  private async limitFailures(userId: string): Promise<void> {
    const windowStart = new Date(Date.now() - this.windowSeconds * 1000).toISOString();
    const result = await this.db.execute(sql`
      SELECT attempts FROM auth_rate_limits
      WHERE key = ${this.failureKey(userId)}
        AND window_started_at >= ${windowStart}::timestamptz`);
    const row = result.rows[0] as { attempts?: number | string } | undefined;
    if (row && Number(row.attempts) >= TWO_STEP_MAX_FAILURES_PER_WINDOW) {
      throw new HttpException(
        { message: TOO_MANY_CODES, reason: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(userId: string, reason: string, meta: RequestMeta): Promise<void> {
    await this.rateLimits.hit(this.failureKey(userId), this.windowSeconds);
    await this.audit.record({
      action: 'auth.two_step.failed',
      outcome: 'failure',
      actorUserId: userId,
      targetType: 'user',
      targetId: userId,
      metadata: { reason },
      meta,
    });
  }

  /** Accepts a code once: the step is recorded atomically, so the same code cannot be reused. */
  private async acceptCode(
    userId: string,
    ciphertext: string,
    lastUsedStep: number | null,
    code: string,
  ): Promise<boolean> {
    const step = verifyTotp(this.crypto.decryptSecret(ciphertext, userId), cleanCode(code), {
      lastUsedStep,
    });
    if (step === null) return false;
    const updated = await this.db
      .update(userTwoStep)
      .set({ lastUsedStep: step, updatedAt: new Date() })
      .where(
        and(
          eq(userTwoStep.userId, userId),
          or(isNull(userTwoStep.lastUsedStep), lt(userTwoStep.lastUsedStep, step)),
        ),
      )
      .returning({ userId: userTwoStep.userId });
    return updated.length === 1;
  }

  private async requireCurrentCode(user: User, code: string, meta: RequestMeta): Promise<void> {
    const [settings] = await this.db
      .select()
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, user.id))
      .limit(1);
    if (!settings?.enabledAt) {
      throw new ConflictException('Two-step sign-in is not turned on for your account.');
    }
    await this.limitFailures(user.id);
    if (!(await this.acceptCode(user.id, settings.secretCiphertext, settings.lastUsedStep, code))) {
      await this.recordFailure(user.id, 'wrong_code', meta);
      throw new BadRequestException(WRONG_CODE);
    }
  }

  private async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (!looksLikeRecoveryCode(code)) return false;
    const used = await this.db
      .update(twoStepRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(twoStepRecoveryCodes.userId, userId),
          eq(twoStepRecoveryCodes.codeHash, this.crypto.hashRecoveryCode(code, userId)),
          isNull(twoStepRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: twoStepRecoveryCodes.id });
    return used.length === 1;
  }

  private async remainingRecoveryCodes(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(twoStepRecoveryCodes)
      .where(and(eq(twoStepRecoveryCodes.userId, userId), isNull(twoStepRecoveryCodes.usedAt)));
    return row?.count ?? 0;
  }

  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await tx.delete(twoStepRecoveryCodes).where(eq(twoStepRecoveryCodes.userId, userId));
      await tx.insert(twoStepRecoveryCodes).values(
        codes.map((code) => ({ userId, codeHash: this.crypto.hashRecoveryCode(code, userId) })),
      );
    });
    return codes;
  }

  private async hasAnything(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: userTwoStep.userId })
      .from(userTwoStep)
      .where(eq(userTwoStep.userId, userId))
      .limit(1);
    return Boolean(row);
  }

  private async removeAll(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(twoStepRecoveryCodes).where(eq(twoStepRecoveryCodes.userId, userId));
      await tx.delete(twoStepChallenges).where(eq(twoStepChallenges.userId, userId));
      await tx.delete(userTwoStep).where(eq(userTwoStep.userId, userId));
    });
  }

  private async notify(
    user: User,
    subject: string,
    paragraphs: string[],
    warning: string,
  ): Promise<void> {
    const content = renderEmail({
      greeting: `Hello ${oneLine(user.displayName)},`,
      paragraphs,
      action: { label: 'Open Constitution Intelligence', url: this.config.WEB_BASE_URL },
      afterAction: [warning],
    });
    await this.mail.send({ to: user.email, subject, ...content });
  }
}
