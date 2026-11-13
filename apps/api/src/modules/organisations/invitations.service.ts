import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  invitations,
  memberships,
  organisations,
  users,
  type Database,
  type Invitation,
} from '@constitution/db';
import { ROLE_LABELS, canAssignRole, type OrganisationRole } from '@constitution/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { AuthContext, RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { generateToken, hashToken } from '../auth/tokens';
import { MailService } from '../mail/mail.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { oneLine, renderEmail } from '../mail/templates';

export const INVALID_INVITATION =
  'This invitation is invalid, has expired or has already been used.';

/** Who is sending an invitation: an organisation member (with their role) or the platform. */
export type Inviter =
  { kind: 'member'; userId: string; role: OrganisationRole } | { kind: 'platform'; userId: string };

export interface InvitationSummary {
  id: string;
  email: string;
  role: OrganisationRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

function summarise(invitation: Invitation): InvitationSummary {
  let status: InvitationSummary['status'] = 'pending';
  if (invitation.acceptedAt) status = 'accepted';
  else if (invitation.revokedAt) status = 'revoked';
  else if (invitation.expiresAt.getTime() <= Date.now()) status = 'expired';
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

export interface AcceptInvitationInput {
  token: string;
  displayName?: string;
  password?: string;
}

export interface AcceptInvitationResult {
  organisationId: string;
  /** The portal address, so the web app can take the person to their portal. */
  organisationSlug: string;
  role: OrganisationRole;
  /** Set when a new account was created; the caller signs the new user in. */
  newUserId?: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tenantDb: TenantDatabase,
  ) {}

  async create(
    organisationId: string,
    inviter: Inviter,
    email: string,
    role: OrganisationRole,
    meta: RequestMeta,
  ): Promise<InvitationSummary & { emailDelivered: boolean }> {
    // Privilege escalation check: members may only grant roles at or below their own,
    // and only Owners may create Owners. The platform may only invite Owners and Administrators.
    const allowed =
      inviter.kind === 'platform'
        ? role === 'owner' || role === 'admin'
        : canAssignRole(inviter.role, role);
    if (!allowed) {
      await this.audit.record({
        action: 'permission.denied',
        outcome: 'denied',
        actorUserId: inviter.userId,
        organisationId,
        metadata: { attempted: 'invitation.create', role },
        meta,
      });
      throw new ForbiddenException(`You cannot grant the ${ROLE_LABELS[role]} role.`);
    }

    const [organisation] = await this.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!organisation) {
      throw new NotFoundException('Organisation not found.');
    }
    if (organisation.deletedAt) {
      throw new ConflictException('This organisation’s data has been deleted.');
    }

    const [existingMember] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(eq(memberships.organisationId, organisationId), eq(users.email, email)))
      .limit(1);
    if (existingMember) {
      throw new ConflictException('This person is already a member of the organisation.');
    }

    const token = generateToken();
    const now = new Date();
    const invitation = await this.db.transaction(async (tx) => {
      // Only the newest invitation for an email address stays valid.
      await tx
        .update(invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invitations.organisationId, organisationId),
            eq(invitations.email, email),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        );
      const [created] = await tx
        .insert(invitations)
        .values({
          organisationId,
          email,
          role,
          tokenHash: hashToken(token),
          invitedByUserId: inviter.userId,
          expiresAt: new Date(now.getTime() + this.config.INVITATION_TTL_HOURS * 3_600_000),
        })
        .returning();
      return created!;
    });

    const link = `${this.config.WEB_BASE_URL}/invitations/accept?token=${encodeURIComponent(token)}`;
    const organisationName = oneLine(organisation.name);
    const content = renderEmail({
      paragraphs: [
        `You have been invited to join ${organisationName} on Constitution Intelligence as ${ROLE_LABELS[role]}.`,
        `${organisationName} uses Constitution Intelligence to share its approved constitution with its members.`,
      ],
      action: { label: 'Accept the invitation', url: link },
      afterAction: [
        `The invitation is valid for ${this.config.INVITATION_TTL_HOURS} hours and can be used once.`,
        'If you were not expecting this invitation, you can ignore this email.',
      ],
    });
    const emailDelivered = await this.mail.send({
      to: email,
      subject: `You are invited to ${organisationName} on Constitution Intelligence`,
      ...content,
    });
    await this.audit.record({
      action: 'invitation.created',
      outcome: 'success',
      actorUserId: inviter.userId,
      organisationId,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email, role, by: inviter.kind, emailDelivered },
      meta,
    });
    // emailDelivered=false: the invitation exists, but the email could not be sent. Inviting the
    // same address again sends a new one (and cancels this one).
    return { ...summarise(invitation), emailDelivered };
  }

  /** Invitations of the caller's organisation, read under Row-Level Security. */
  async list(scope: TenantScope): Promise<InvitationSummary[]> {
    const rows = await this.tenantDb.run(scope, (tx) =>
      tx
        .select()
        .from(invitations)
        .where(eq(invitations.organisationId, scope.organisationId))
        .orderBy(desc(invitations.createdAt))
        .limit(200),
    );
    return rows.map(summarise);
  }

  async revoke(
    organisationId: string,
    invitationId: string,
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const revoked = await this.db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.organisationId, organisationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id });
    if (revoked.length === 0) {
      throw new NotFoundException('Pending invitation not found.');
    }
    await this.audit.record({
      action: 'invitation.revoked',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'invitation',
      targetId: invitationId,
      meta,
    });
  }

  /**
   * Accepts an invitation.
   * - If the invited email has no account yet, a new account is created with the given name and password.
   * - If it already has an account, the person must be signed in as that account.
   */
  async accept(
    input: AcceptInvitationInput,
    auth: AuthContext | undefined,
    meta: RequestMeta,
  ): Promise<AcceptInvitationResult> {
    const now = new Date();
    const [row] = await this.db
      .select({
        invitation: invitations,
        organisationStatus: organisations.status,
        organisationSlug: organisations.slug,
      })
      .from(invitations)
      .innerJoin(organisations, eq(invitations.organisationId, organisations.id))
      .where(
        and(
          eq(invitations.tokenHash, hashToken(input.token)),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row || row.organisationStatus !== 'active') {
      await this.audit.record({
        action: 'invitation.accept_failed',
        outcome: 'failure',
        actorUserId: auth?.userId ?? null,
        metadata: { reason: row ? 'organisation_not_active' : 'invalid_or_expired_token' },
        meta,
      });
      throw new BadRequestException(INVALID_INVITATION);
    }
    const invitation = row.invitation;

    const [existingUser] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, invitation.email))
      .limit(1);

    if (existingUser) {
      if (!auth || auth.userId !== existingUser.id) {
        throw new UnauthorizedException(
          'An account already exists for the invited email address. Please sign in with it, then accept the invitation again.',
        );
      }
      if (existingUser.status !== 'active') {
        throw new ForbiddenException(
          'This account is not active. Please contact your administrator.',
        );
      }
    } else if (auth) {
      await this.audit.record({
        action: 'invitation.accept_failed',
        outcome: 'denied',
        actorUserId: auth.userId,
        organisationId: invitation.organisationId,
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { reason: 'signed_in_as_different_user' },
        meta,
      });
      throw new ForbiddenException('This invitation was sent to a different email address.');
    }

    let newUserPasswordHash: string | undefined;
    let newUserDisplayName: string | undefined;
    if (!existingUser) {
      if (!input.displayName || !input.password) {
        throw new BadRequestException(
          'Please provide your name and a password to create your account.',
        );
      }
      this.passwords.assertAcceptable(input.password, {
        email: invitation.email,
        displayName: input.displayName,
      });
      newUserPasswordHash = await this.passwords.hash(input.password);
      newUserDisplayName = input.displayName;
    }

    const result = await this.db.transaction(async (tx) => {
      const claimed = await tx
        .update(invitations)
        .set({ acceptedAt: now })
        .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });
      if (claimed.length === 0) {
        throw new BadRequestException(INVALID_INVITATION);
      }

      let userId = existingUser?.id;
      if (!userId) {
        const [created] = await tx
          .insert(users)
          .values({
            email: invitation.email,
            displayName: newUserDisplayName!,
            passwordHash: newUserPasswordHash!,
            passwordChangedAt: now,
          })
          .returning({ id: users.id });
        userId = created!.id;
      }

      const inserted = await tx
        .insert(memberships)
        .values({ organisationId: invitation.organisationId, userId, role: invitation.role })
        .onConflictDoNothing({ target: [memberships.organisationId, memberships.userId] })
        .returning({ id: memberships.id });
      if (inserted.length === 0) {
        throw new ConflictException('You are already a member of this organisation.');
      }

      await tx
        .update(invitations)
        .set({ acceptedByUserId: userId })
        .where(eq(invitations.id, invitation.id));
      return { userId, membershipId: inserted[0]!.id };
    });

    if (!existingUser) {
      await this.audit.record({
        action: 'user.created',
        outcome: 'success',
        actorUserId: result.userId,
        organisationId: invitation.organisationId,
        targetType: 'user',
        targetId: result.userId,
        metadata: { via: 'invitation' },
        meta,
      });
    }
    await this.audit.record({
      action: 'invitation.accepted',
      outcome: 'success',
      actorUserId: result.userId,
      organisationId: invitation.organisationId,
      targetType: 'membership',
      targetId: result.membershipId,
      metadata: { role: invitation.role, invitationId: invitation.id },
      meta,
    });

    return {
      organisationId: invitation.organisationId,
      organisationSlug: row.organisationSlug,
      role: invitation.role,
      newUserId: existingUser ? undefined : result.userId,
    };
  }
}
