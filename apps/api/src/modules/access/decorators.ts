import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { OrganisationPermission } from '@constitution/shared';
import type { AppRequest, AuthContext, MembershipContext } from '../../common/request-context';

export const IS_PUBLIC = 'access:isPublic';
export const REQUIRED_ORG_PERMISSION = 'access:orgPermission';
export const REQUIRES_SUPER_ADMIN = 'access:superAdmin';

/**
 * Marks a route as reachable without signing in.
 * Every other route requires a valid session: access is denied by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires the signed-in user to hold an active membership in the organisation given by the
 * `:organisationId` route parameter, with a role that grants `permission`.
 */
export const RequireOrgPermission = (permission: OrganisationPermission) =>
  SetMetadata(REQUIRED_ORG_PERMISSION, permission);

/** Requires the signed-in user to be a Platform Super Admin. */
export const RequireSuperAdmin = () => SetMetadata(REQUIRES_SUPER_ADMIN, true);

/** The signed-in user (guaranteed on non-public routes). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext | undefined =>
    context.switchToHttp().getRequest<AppRequest>().auth,
);

/** The caller's membership in the organisation from the URL (set when RequireOrgPermission is used). */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MembershipContext | undefined =>
    context.switchToHttp().getRequest<AppRequest>().membership,
);
