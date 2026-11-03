/**
 * Roles and permissions for Constitution Intelligence.
 *
 * This file is the single source of truth. The API enforces it on every request;
 * the web app may read it only to decide which buttons to show (never for security).
 */

/** Roles a person can hold inside one organisation. */
export const ORGANISATION_ROLES = [
  'owner',
  'admin',
  'content_reviewer',
  'member',
  'auditor',
] as const;
export type OrganisationRole = (typeof ORGANISATION_ROLES)[number];

/** The platform-level role. Held by Constitution Intelligence staff, never by organisations. */
export const PLATFORM_SUPER_ADMIN = 'platform_super_admin' as const;

export const ROLE_LABELS: Readonly<Record<OrganisationRole | typeof PLATFORM_SUPER_ADMIN, string>> =
  {
    platform_super_admin: 'Platform Super Admin',
    owner: 'Organisation Owner',
    admin: 'Organisation Administrator',
    content_reviewer: 'Organisation Content Reviewer',
    member: 'Organisation Member',
    auditor: 'Auditor (read-only)',
  };

/**
 * Actions inside an organisation.
 * Content: edit = upload documents and correct extracted text; review = see drafts and their
 * approval status; approve = approve, publish (make current) or archive a version.
 */
export const ORGANISATION_PERMISSIONS = [
  'organisation.read',
  'organisation.settings.manage',
  'constitution.read',
  'content.edit',
  'content.review',
  'content.approve',
  'members.read',
  'members.invite',
  'members.manage',
  'branding.manage',
  'billing.read',
  'billing.manage',
  'audit.read',
] as const;
export type OrganisationPermission = (typeof ORGANISATION_PERMISSIONS)[number];

const READ_BASICS: readonly OrganisationPermission[] = ['organisation.read', 'constitution.read'];

export const ROLE_PERMISSIONS: Readonly<
  Record<OrganisationRole, readonly OrganisationPermission[]>
> = {
  owner: ORGANISATION_PERMISSIONS,
  // Administrators give the organisation's final approval to constitution versions (Stage 7).
  // They can see the subscription; only Owners report payments (billing.manage).
  admin: [
    ...READ_BASICS,
    'content.edit',
    'content.review',
    'content.approve',
    'members.read',
    'members.invite',
    'members.manage',
    'branding.manage',
    'billing.read',
    'audit.read',
  ],
  // Reviewers check and correct extracted text and send it for approval; they do not approve.
  content_reviewer: [...READ_BASICS, 'content.edit', 'content.review'],
  member: [...READ_BASICS],
  // Read-only oversight: can see members, billing and the audit trail, but change nothing.
  auditor: [...READ_BASICS, 'members.read', 'billing.read', 'audit.read'],
};

/** Higher number = more authority. Used to stop people granting or managing above their level. */
const ROLE_RANK: Readonly<Record<OrganisationRole, number>> = {
  owner: 100,
  admin: 80,
  content_reviewer: 40,
  auditor: 30,
  member: 20,
};

export function isOrganisationRole(value: unknown): value is OrganisationRole {
  return typeof value === 'string' && (ORGANISATION_ROLES as readonly string[]).includes(value);
}

export function roleHasPermission(
  role: OrganisationRole,
  permission: OrganisationPermission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * May someone holding `actorRole` give another person `targetRole` (by invitation or role change)?
 * - Only an Owner can create another Owner.
 * - Nobody can grant a role ranked above their own.
 */
export function canAssignRole(actorRole: OrganisationRole, targetRole: OrganisationRole): boolean {
  if (!roleHasPermission(actorRole, 'members.invite')) {
    return false;
  }
  if (targetRole === 'owner') {
    return actorRole === 'owner';
  }
  return ROLE_RANK[targetRole] <= ROLE_RANK[actorRole];
}

/**
 * May someone holding `actorRole` change or remove a person who currently holds `targetRole`?
 * Owners may manage anyone; Administrators only people ranked below them
 * (so an Administrator cannot demote or remove an Owner or another Administrator).
 */
export function canManageMember(
  actorRole: OrganisationRole,
  targetRole: OrganisationRole,
): boolean {
  if (!roleHasPermission(actorRole, 'members.manage')) {
    return false;
  }
  if (actorRole === 'owner') {
    return true;
  }
  return ROLE_RANK[targetRole] < ROLE_RANK[actorRole];
}
