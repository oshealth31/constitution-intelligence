import type { OrganisationRole } from '@constitution/shared';
import type { Request } from 'express';

/** Who is making the request (set by AuthGuard from a valid session). */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  displayName: string;
  isPlatformSuperAdmin: boolean;
}

/** The caller's membership in the organisation named in the URL (set by PermissionGuard). */
export interface MembershipContext {
  membershipId: string;
  organisationId: string;
  role: OrganisationRole;
}

export type AppRequest = Request & {
  id?: unknown;
  auth?: AuthContext;
  membership?: MembershipContext;
};

/** Facts about the request recorded with security events. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestMeta(request: AppRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    requestId: typeof request.id === 'string' ? request.id : null,
  };
}
