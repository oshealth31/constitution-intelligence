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
import { AuditService } from '../audit/audit.service';
import { REQUIRED_ORG_PERMISSION, REQUIRES_SUPER_ADMIN } from './decorators';

export const ORGANISATION_NOT_FOUND = 'Organisation not found.';
export const NOT_PERMITTED = 'You do not have permission to do this.';

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
      const organisationId = request.params.organisationId;
      if (!uuidSchema.safeParse(organisationId).success) {
        throw new NotFoundException(ORGANISATION_NOT_FOUND);
      }
      const [membership] = await this.db
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .innerJoin(organisations, eq(memberships.organisationId, organisations.id))
        .where(
          and(
            eq(memberships.organisationId, organisationId as string),
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
      request.membership = {
        membershipId: membership.id,
        organisationId: organisationId as string,
        role: membership.role,
      };
    }
    return true;
  }
}
