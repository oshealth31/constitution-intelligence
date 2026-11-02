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
