/**
 * Browser client for the Constitution Intelligence API.
 * Requests go to /api/v1/* on the web app's own address, which forwards them to the API,
 * so the HttpOnly session cookie is sent automatically. The API enforces every permission;
 * nothing here is a security control.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: string[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { message?: string; details?: string[]; requestId?: string };
}

export async function apiFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      // Required by the API's CSRF protection for state-changing requests.
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const data: unknown = text ? safeParse(text) : undefined;
  if (!response.ok) {
    const error = (data as ErrorBody | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.message ?? `Request failed (${response.status}).`,
      error?.details ?? [],
      error?.requestId,
    );
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A readable message for any error, including field-level details from the API. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.details.length > 0 ? `${error.message} ${error.details.join('; ')}` : error.message;
  }
  return 'Something went wrong. Please check your connection and try again.';
}

// ----- Response types used by the control centre ---------------------------------------------

export interface CurrentUser {
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    isPlatformSuperAdmin: boolean;
  } | null;
  memberships: { organisationId: string; organisationName: string; role: string }[];
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface MetricTotal {
  metric: string;
  total: number;
}

export interface Overview {
  totals: {
    organisationsTotal: number;
    organisationsActive: number;
    organisationsSuspended: number;
    usersTotal: number;
    usersActive: number;
    activeMemberships: number;
    constitutions: number;
    pendingInvitations: number;
    failedLogins24h: number;
    auditEvents24h: number;
  };
  subscriptionsByStatus: StatusCount[];
  versionsByStatus: StatusCount[];
  usage30d: MetricTotal[];
  recentOrganisations: { id: string; name: string; slug: string; status: string; createdAt: string }[];
}

export interface OnboardingProgress {
  steps: { key: string; label: string; done: boolean }[];
  completed: number;
  total: number;
}

export interface OrganisationListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  subscription: { planCode: string; status: string; currentPeriodEnd: string | null } | null;
  activeMembers: number;
  publishedVersions: number;
  versionsInProgress: number;
  onboarding: OnboardingProgress;
}

export interface OrganisationDetail {
  organisation: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  branding: {
    displayName: string | null;
    tagline: string | null;
    primaryColour: string;
    accentColour: string;
    logoFileId: string | null;
  } | null;
  subscription: {
    id: string;
    planCode: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string | null;
  } | null;
  administrators: {
    membershipId: string;
    userId: string;
    displayName: string;
    email: string;
    role: string;
    membershipStatus: string;
    accountStatus: string;
    lastSignInAt: string | null;
  }[];
  administratorInvitations: { id: string; email: string; role: string; expiresAt: string }[];
  memberCounts: { role: string; count: number }[];
  onboarding: OnboardingProgress;
  processing: {
    versionsByStatus: StatusCount[];
    latestVersion: {
      id: string;
      versionNumber: number;
      label: string;
      status: string;
      updatedAt: string;
      constitutionTitle: string;
      sectionCount: number;
      textExtracted: boolean;
    } | null;
    files: number;
    storageBytes: number;
  };
  usage30d: MetricTotal[];
}

export interface AuditEventItem {
  id: string;
  occurredAt: string;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  organisationId: string | null;
  organisationName: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

export interface SupportOverview {
  counts: {
    failedLogins24h: number;
    rateLimited24h: number;
    permissionDenied24h: number;
    inactiveAccounts: number;
    expiredInvitations30d: number;
  };
  organisationsWithoutOwner: { id: string; name: string }[];
  trialsEndingSoon: { id: string; name: string; currentPeriodEnd: string }[];
  paymentAttention: { id: string; name: string; status: string }[];
  recentSecurityEvents: {
    occurredAt: string;
    action: string;
    outcome: string;
    organisationId: string | null;
    targetType: string | null;
    targetId: string | null;
    ipAddress: string | null;
  }[];
}

export interface SystemHealth {
  status: 'ok' | 'degraded';
  checks: {
    database: { status: string; latencyMs: number | null };
    migrations: { status: string; applied: number | null; expected: number };
    storage: { status: string; driver: string };
    email: { status: string; transport: string };
  };
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}
