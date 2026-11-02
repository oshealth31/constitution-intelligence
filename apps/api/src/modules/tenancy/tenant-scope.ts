import type { OrganisationRole } from '@constitution/shared';

const tenantScopeBrand: unique symbol = Symbol('TenantScope');

/**
 * Proof that the caller is an active member of `organisationId`, created ONLY by
 * PermissionGuard after checking the membership in the database.
 *
 * Tenant-scoped services accept a TenantScope instead of a plain organisation ID, so an
 * organisation ID taken from a request body, query string or header cannot be used to
 * reach tenant data: the type system refuses it.
 */
export interface TenantScope {
  readonly organisationId: string;
  readonly userId: string;
  readonly role: OrganisationRole;
  readonly [tenantScopeBrand]: true;
}

/** For PermissionGuard (and trusted server-side jobs/tests) only. */
export function createTenantScope(
  organisationId: string,
  userId: string,
  role: OrganisationRole,
): TenantScope {
  return Object.freeze({ organisationId, userId, role, [tenantScopeBrand]: true as const });
}
