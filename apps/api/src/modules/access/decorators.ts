import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { OrganisationPermission, PlanFeature } from '@constitution/shared';
import type { AppRequest, AuthContext, MembershipContext } from '../../common/request-context';
import type { TenantScope } from '../tenancy/tenant-scope';

export const IS_PUBLIC = 'access:isPublic';
export const REQUIRED_ORG_PERMISSION = 'access:orgPermission';
export const REQUIRES_SUPER_ADMIN = 'access:superAdmin';
export const REQUIRED_FEATURE = 'access:planFeature';
export const ALLOW_INACTIVE_SUBSCRIPTION = 'access:allowInactiveSubscription';

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

/**
 * Requires the organisation's plan to include `feature` (checked on the server together with
 * the permission). Without it the request is refused with reason FEATURE_NOT_IN_PLAN.
 */
export const RequireFeature = (feature: PlanFeature) => SetMetadata(REQUIRED_FEATURE, feature);

/**
 * Lets a route work even when the organisation's subscription is suspended, missing or
 * restricted — for the billing page (so an owner can see what is due and report a payment) and
 * the portal home page (so members see why the portal is unavailable). Use sparingly.
 */
export const AllowInactiveSubscription = () => SetMetadata(ALLOW_INACTIVE_SUBSCRIPTION, true);

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

/**
 * The verified tenant context (organisation, user, role) for routes using RequireOrgPermission.
 * This is the ONLY way controllers obtain an organisation for tenant-scoped work.
 */
export const Tenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantScope | undefined =>
    context.switchToHttp().getRequest<AppRequest>().membership?.tenant,
);
