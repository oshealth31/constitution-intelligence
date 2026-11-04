import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { memberships, organisations, type Database } from '@constitution/db';
import { roleHasPermission, type OrganisationPermission } from '@constitution/shared';
import { and, eq } from 'drizzle-orm';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { uuidSchema } from '../../common/validation';
import { DRIZZLE } from '../../database/database.constants';
import { createTenantScope } from '../tenancy/tenant-scope';
import { AuditService } from '../audit/audit.service';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { loadAccess } from '../subscriptions/access';
import {
  ALLOW_INACTIVE_SUBSCRIPTION,
  REQUIRED_FEATURE,
  REQUIRED_ORG_PERMISSION,
  REQUIRES_SUPER_ADMIN,
} from './decorators';
import type { PlanFeature } from '@constitution/shared';

export const ORGANISATION_NOT_FOUND = 'Organisation not found.';
export const NOT_PERMITTED = 'You do not have permission to do this.';
export const TWO_STEP_SETUP_REQUIRED =
  'Set up two-step sign-in before using the Control Centre. It is required for Platform Super Admins.';

/** Refusals caused by the subscription carry a machine-readable reason. */
function subscriptionRefusal(reason: string, message: string) {
  return new ForbiddenException({ message, reason });
}

/**
 * Enforces @RequireSuperAdmin() and @RequireOrgPermission() on the server.
 * - A person with no active membership in the organisation gets 404, so organisations they
 *   do not belong to cannot even be confirmed to exist.
 * - A member whose role lacks the permission gets 403, and the attempt is audited.
 * Platform Super Admins do NOT automatically receive organisation permissions.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const needsSuperAdmin = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_SUPER_ADMIN,
      targets,
    );
    const permission = this.reflector.getAllAndOverride<OrganisationPermission | undefined>(
      REQUIRED_ORG_PERMISSION,
      targets,
    );
    if (!needsSuperAdmin && !permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AppRequest>();
    const auth = request.auth;
    if (!auth) {
      return false; // AuthGuard has already refused unauthenticated access to protected routes.
    }

    // A Super Admin who has not set up two-step sign-in can reach only their own account and
    // the setup steps (the /auth routes), never the Control Centre or an organisation.
    if (auth.isPlatformSuperAdmin && !auth.twoStepEnabled) {
      await this.audit.record({
        action: 'permission.denied',
        outcome: 'denied',
        actorUserId: auth.userId,
        metadata: { required: 'two_step_sign_in', route: request.route?.path },
        meta: requestMeta(request),
      });
      throw new ForbiddenException({
        message: TWO_STEP_SETUP_REQUIRED,
        reason: 'TWO_STEP_SETUP_REQUIRED',
      });
    }

    if (needsSuperAdmin && !auth.isPlatformSuperAdmin) {
      await this.audit.record({
        action: 'permission.denied',
        outcome: 'denied',
        actorUserId: auth.userId,
        metadata: { required: 'platform_super_admin', route: request.route?.path },
        meta: requestMeta(request),
      });
      throw new ForbiddenException(NOT_PERMITTED);
    }

    if (permission) {
      const parsedId = uuidSchema.safeParse(request.params.organisationId);
      if (!parsedId.success) {
        throw new NotFoundException(ORGANISATION_NOT_FOUND);
      }
      const organisationId = parsedId.data;
      const [membership] = await this.db
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .innerJoin(organisations, eq(memberships.organisationId, organisations.id))
        .where(
          and(
            eq(memberships.organisationId, organisationId),
            eq(memberships.userId, auth.userId),
            eq(memberships.status, 'active'),
            eq(organisations.status, 'active'),
          ),
        )
        .limit(1);

      if (!membership) {
        await this.audit.record({
          action: 'permission.denied',
          outcome: 'denied',
          actorUserId: auth.userId,
          organisationId,
          metadata: { required: permission, reason: 'not_a_member' },
          meta: requestMeta(request),
        });
        throw new NotFoundException(ORGANISATION_NOT_FOUND);
      }
      if (!roleHasPermission(membership.role, permission)) {
        await this.audit.record({
          action: 'permission.denied',
          outcome: 'denied',
          actorUserId: auth.userId,
          organisationId,
          metadata: { required: permission, role: membership.role },
          meta: requestMeta(request),
        });
        throw new ForbiddenException(NOT_PERMITTED);
      }

      // Subscription and plan, enforced here on the server for every organisation route.
      const access = await loadAccess(
        this.db,
        organisationId,
        new Date(),
        this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
      );
      request.subscriptionAccess = access;
      const allowInactive = this.reflector.getAllAndOverride<boolean>(
        ALLOW_INACTIVE_SUBSCRIPTION,
        targets,
      );
      if (!allowInactive && !access.fullAccess) {
        const adminRead =
          access.readOnly &&
          (membership.role === 'owner' || membership.role === 'admin') &&
          (request.method === 'GET' || request.method === 'HEAD');
        if (!adminRead) {
          await this.audit.record({
            action: 'permission.denied',
            outcome: 'denied',
            actorUserId: auth.userId,
            organisationId,
            metadata: { required: permission, reason: 'subscription', state: access.state },
            meta: requestMeta(request),
          });
          throw access.readOnly
            ? subscriptionRefusal('SUBSCRIPTION_READ_ONLY', access.message)
            : subscriptionRefusal('SUBSCRIPTION_INACTIVE', access.message);
        }
      }
      const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(
        REQUIRED_FEATURE,
        targets,
      );
      if (feature && !access.features.includes(feature)) {
        throw subscriptionRefusal(
          'FEATURE_NOT_IN_PLAN',
          'This feature is not included in your organisation’s plan.',
        );
      }

      request.membership = {
        membershipId: membership.id,
        organisationId,
        role: membership.role,
        tenant: createTenantScope(organisationId, auth.userId, membership.role),
      };
    }
    return true;
  }
}
