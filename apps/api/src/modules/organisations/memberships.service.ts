import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { memberships, users, type Database, type Membership } from '@constitution/db';
import {
  ROLE_LABELS,
  canAssignRole,
  canManageMember,
  type OrganisationRole,
} from '@constitution/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { MembershipContext, RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';

export const LAST_OWNER =
  'An organisation must always keep at least one active Organisation Owner.';

export interface MembershipChange {
  role?: OrganisationRole;
  status?: Membership['status'];
}

@Injectable()
export class MembershipsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(organisationId: string) {
    return this.db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: memberships.role,
        status: memberships.status,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.organisationId, organisationId))
      .orderBy(users.displayName);
  }

  async update(
    actor: MembershipContext & { userId: string },
    membershipId: string,
    change: MembershipChange,
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const target = await this.loadTargetForChange(tx, actor, membershipId, meta);

      if (change.role && change.role !== target.role && !canAssignRole(actor.role, change.role)) {
        await this.deny(actor, membershipId, 'grant_role_above_own', meta, { role: change.role });
        throw new ForbiddenException(`You cannot grant the ${ROLE_LABELS[change.role]} role.`);
      }

      const losesOwner =
        target.role === 'owner' &&
        ((change.role !== undefined && change.role !== 'owner') || change.status === 'suspended');
      if (losesOwner) {
        await this.assertAnotherActiveOwner(tx, actor.organisationId, membershipId);
      }

      await tx
        .update(memberships)
        .set({
          ...(change.role ? { role: change.role } : {}),
          ...(change.status ? { status: change.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(memberships.id, membershipId));

      if (change.role && change.role !== target.role) {
        await this.audit.record({
          action: 'membership.role_changed',
          outcome: 'success',
          actorUserId: actor.userId,
          organisationId: actor.organisationId,
          targetType: 'membership',
          targetId: membershipId,
          metadata: { userId: target.userId, from: target.role, to: change.role },
          meta,
        });
      }
      if (change.status && change.status !== target.status) {
        await this.audit.record({
          action: 'membership.status_changed',
          outcome: 'success',
          actorUserId: actor.userId,
          organisationId: actor.organisationId,
          targetType: 'membership',
          targetId: membershipId,
          metadata: { userId: target.userId, from: target.status, to: change.status },
          meta,
        });
      }
    });
  }

  async remove(
    actor: MembershipContext & { userId: string },
    membershipId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const target = await this.loadTargetForChange(tx, actor, membershipId, meta);
      if (target.role === 'owner') {
        await this.assertAnotherActiveOwner(tx, actor.organisationId, membershipId);
      }
      await tx.delete(memberships).where(eq(memberships.id, membershipId));
      await this.audit.record({
        action: 'membership.removed',
        outcome: 'success',
        actorUserId: actor.userId,
        organisationId: actor.organisationId,
        targetType: 'membership',
        targetId: membershipId,
        metadata: { userId: target.userId, role: target.role },
        meta,
      });
    });
  }

  /**
   * Loads the membership being changed, after locking the organisation's memberships so
   * concurrent changes cannot remove the last owner. Applies the shared safety rules.
   */
  private async loadTargetForChange(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    actor: MembershipContext & { userId: string },
    membershipId: string,
    meta: RequestMeta,
  ): Promise<Membership> {
    await tx.execute(
      sql`SELECT id FROM memberships WHERE organisation_id = ${actor.organisationId} FOR UPDATE`,
    );
    const [target] = await tx
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.id, membershipId), eq(memberships.organisationId, actor.organisationId)),
      )
      .limit(1);
    // A membership in another organisation is reported as "not found", never as forbidden.
    if (!target) {
      throw new NotFoundException('Member not found.');
    }
    if (target.userId === actor.userId) {
      await this.deny(actor, membershipId, 'change_own_membership', meta);
      throw new ForbiddenException(
        'You cannot change or remove your own membership. Ask another owner or administrator.',
      );
    }
    if (!canManageMember(actor.role, target.role)) {
      await this.deny(actor, membershipId, 'manage_higher_or_equal_role', meta, {
        targetRole: target.role,
      });
      throw new ForbiddenException(`You cannot manage a ${ROLE_LABELS[target.role]}.`);
    }
    return target;
  }

  private async assertAnotherActiveOwner(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    organisationId: string,
    excludingMembershipId: string,
  ): Promise<void> {
    const [other] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organisationId, organisationId),
          eq(memberships.role, 'owner'),
          eq(memberships.status, 'active'),
          ne(memberships.id, excludingMembershipId),
        ),
      )
      .limit(1);
    if (!other) {
      throw new ConflictException(LAST_OWNER);
    }
  }

  private deny(
    actor: MembershipContext & { userId: string },
    membershipId: string,
    reason: string,
    meta: RequestMeta,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.audit.record({
      action: 'permission.denied',
      outcome: 'denied',
      actorUserId: actor.userId,
      organisationId: actor.organisationId,
      targetType: 'membership',
      targetId: membershipId,
      metadata: { reason, actorRole: actor.role, ...extra },
      meta,
    });
  }
}
