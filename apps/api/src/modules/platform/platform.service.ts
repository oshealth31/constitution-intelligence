import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  organisationBranding,
  organisations,
  subscriptions,
  users,
  type Database,
  type User,
} from '@constitution/db';
import { desc, eq } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { toPublicUser, type PublicUser } from '../auth/users.service';

const TRIAL_DAYS = 30;

/** Platform Super Admin operations. Organisation management is expanded in a later stage. */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Creates an organisation with its default branding and a trial subscription,
   * all in one transaction.
   */
  async createOrganisation(name: string, slug: string, actorUserId: string, meta: RequestMeta) {
    const created = await this.db.transaction(async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({ name, slug })
        .onConflictDoNothing({ target: organisations.slug })
        .returning();
      if (!organisation) {
        throw new ConflictException('An organisation with this web address (slug) already exists.');
      }
      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          organisationId: organisation.id,
          planCode: 'trial',
          status: 'trialing',
          currentPeriodEnd: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
        })
        .returning({ id: subscriptions.id });
      await tx
        .insert(organisationBranding)
        .values({ organisationId: organisation.id, displayName: name });
      const [updated] = await tx
        .update(organisations)
        .set({ currentSubscriptionId: subscription!.id })
        .where(eq(organisations.id, organisation.id))
        .returning();
      return updated!;
    });
    await this.audit.record({
      action: 'organisation.created',
      outcome: 'success',
      actorUserId,
      organisationId: created.id,
      targetType: 'organisation',
      targetId: created.id,
      metadata: { name, slug },
      meta,
    });
    return created;
  }

  listOrganisations() {
    return this.db.select().from(organisations).orderBy(desc(organisations.createdAt)).limit(500);
  }

  async setUserStatus(
    userId: string,
    status: User['status'],
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<PublicUser> {
    if (userId === actorUserId) {
      throw new ForbiddenException('You cannot change the status of your own account.');
    }
    const [before] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!before) {
      throw new NotFoundException('User not found.');
    }
    const [updated] = await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    let sessionsRevoked = 0;
    if (status !== 'active') {
      sessionsRevoked = await this.sessions.revokeAllForUser(userId, `account_${status}`);
    }
    await this.audit.record({
      action: 'user.status_changed',
      outcome: 'success',
      actorUserId,
      targetType: 'user',
      targetId: userId,
      metadata: { from: before.status, to: status, sessionsRevoked },
      meta,
    });
    return toPublicUser(updated!);
  }

  /**
   * Creates (or promotes) a Platform Super Admin WITHOUT setting any password.
   * Returns a one-time link the person uses to choose their own password.
   * Used only by the command-line bootstrap script.
   */
  async bootstrapSuperAdmin(
    email: string,
    displayName: string,
  ): Promise<{ user: PublicUser; created: boolean; setupLink: string }> {
    const meta: RequestMeta = { ipAddress: null, userAgent: 'cli', requestId: null };
    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    let user: User;
    if (existing) {
      const [promoted] = await this.db
        .update(users)
        .set({ isPlatformSuperAdmin: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      user = promoted!;
    } else {
      const [created] = await this.db
        .insert(users)
        .values({ email, displayName, isPlatformSuperAdmin: true })
        .returning();
      user = created!;
      await this.audit.record({
        action: 'user.created',
        outcome: 'success',
        targetType: 'user',
        targetId: user.id,
        metadata: { via: 'cli_bootstrap' },
        meta,
      });
    }
    await this.audit.record({
      action: 'user.super_admin_granted',
      outcome: 'success',
      targetType: 'user',
      targetId: user.id,
      metadata: { via: 'cli_bootstrap' },
      meta,
    });
    const setupLink = await this.auth.issuePasswordResetLink(user.id);
    return { user: toPublicUser(user), created: !existing, setupLink };
  }
}
