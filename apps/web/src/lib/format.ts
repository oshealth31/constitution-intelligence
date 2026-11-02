const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived',
  deactivated: 'Deactivated',
  trialing: 'Trial',
  past_due: 'Past due',
  cancelled: 'Cancelled',
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
  superseded: 'Superseded',
  success: 'Success',
  failure: 'Failure',
  denied: 'Denied',
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  pending: 'Pending',
  unknown: 'Unknown',
  development_log: 'Development log only',
  not_configured: 'Not configured',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export type Tone = 'good' | 'warning' | 'critical' | 'neutral' | 'info';

export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'active':
    case 'published':
    case 'success':
    case 'ok':
      return 'good';
    case 'trialing':
    case 'in_review':
    case 'approved':
    case 'pending':
    case 'development_log':
      return 'info';
    case 'past_due':
    case 'failure':
    case 'degraded':
    case 'draft':
    case 'not_configured':
      return 'warning';
    case 'suspended':
    case 'cancelled':
    case 'denied':
    case 'down':
    case 'deactivated':
      return 'critical';
    default:
      return 'neutral';
  }
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  content_reviewer: 'Content reviewer',
  member: 'Member',
  auditor: 'Auditor',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const METRIC_LABELS: Record<string, string> = {
  'ai.questions': 'AI questions',
  'storage.bytes': 'Storage used',
};

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

export function formatMetric(metric: string, value: number): string {
  return metric.endsWith('.bytes') ? formatBytes(value) : formatNumber(value);
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-GB').format(value ?? 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** "auth.login.failed" -> "Auth · login failed" */
export function actionLabel(action: string): string {
  const [area, ...rest] = action.split('.');
  const detail = rest.join(' ').replace(/_/g, ' ');
  return detail ? `${(area ?? '').replace(/^\w/, (c) => c.toUpperCase())} · ${detail}` : action;
}

// ----- Audit event details in plain language -----------------------------------------------

const DETAIL_SKIP = new Set(['userId', 'invitationId', 'by']);

const VALUE_LABELS: Record<string, string> = {
  platform_super_admin: 'Platform Super Admin',
  wrong_password: 'wrong password',
  unknown_account: 'no account with this email',
  invalid_or_expired_token: 'link invalid or expired',
  not_a_member: 'not a member of the organisation',
  published_sections: 'published constitution sections',
  change_own_membership: 'tried to change own membership',
  manage_higher_or_equal_role: 'tried to manage a higher or equal role',
  grant_role_above_own: 'tried to grant a role above own',
  signed_in_as_different_user: 'signed in as a different person',
  account_suspended: 'account suspended',
  account_deactivated: 'account deactivated',
};

function words(key: string): string {
  const text = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plainValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') {
    if (VALUE_LABELS[value]) return VALUE_LABELS[value];
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value);
    if (ROLE_LABELS[value]) return roleLabel(value);
    if (STATUS_LABELS[value]) return statusLabel(value);
    return value.replace(/_/g, ' ');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => plainValue(item)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== null && inner !== undefined)
      .map(([key, inner]) => `${words(key).toLowerCase()} ${plainValue(inner)}`)
      .join(', ');
  }
  return String(value);
}

/**
 * Turns an audit event's technical details into short, readable lines, for example
 * "Changed from Trial to Active" or "Reason: Customer asked us to check clause numbering".
 */
export function describeAuditDetails(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata) return [];
  const lines: string[] = [];
  const { from, to, changes, ...rest } = metadata as Record<string, unknown> & {
    changes?: Record<string, { from?: unknown; to?: unknown }>;
  };
  if (from !== undefined || to !== undefined) {
    lines.push(`Changed from ${plainValue(from)} to ${plainValue(to)}`);
  }
  if (changes && typeof changes === 'object') {
    for (const [field, change] of Object.entries(changes)) {
      lines.push(
        `${words(field)} changed from ${plainValue(change?.from)} to ${plainValue(change?.to)}`,
      );
    }
  }
  for (const [key, value] of Object.entries(rest)) {
    if (DETAIL_SKIP.has(key) || value === null || value === undefined) continue;
    if (key === 'sessionsRevoked' || key === 'otherSessionsRevoked') {
      lines.push(`${plainValue(value)} session(s) signed out`);
    } else if (key === 'sectionsReturned') {
      lines.push(`${plainValue(value)} section(s) shown`);
    } else if (key === 'required') {
      lines.push(`Needed: ${plainValue(value)}`);
    } else if (key === 'fields') {
      lines.push(
        `Fields: ${Array.isArray(value) ? value.map((field) => words(String(field)).toLowerCase()).join(', ') : plainValue(value)}`,
      );
    } else {
      lines.push(`${words(key)}: ${plainValue(value)}`);
    }
  }
  return lines;
}
