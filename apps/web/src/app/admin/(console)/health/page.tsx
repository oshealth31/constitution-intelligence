'use client';

import { Alert, Button, Card, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { describeError, type SystemHealth } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useApi } from '@/lib/use-api';

export default function HealthPage() {
  const health = useApi<SystemHealth>('/platform/health');
  const data = health.data;

  return (
    <>
      <PageHeader
        title="System health"
        description="Live checks of the API, database, migrations, file storage and email."
        actions={
          <Button variant="secondary" busy={health.loading} onClick={() => void health.reload()}>
            Check again
          </Button>
        }
      />
      {health.error ? <Alert>{describeError(health.error)}</Alert> : null}
      {!data && !health.error && <Loading />}
      {data && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <StatusBadge status={data.status} />
              <p className="text-sm text-muted">
                Version {data.version} · {data.environment} environment · up{' '}
                {formatDuration(data.uptimeSeconds)} · checked {formatDateTime(data.timestamp)}
              </p>
            </div>
          </Card>
          <div className="grid gap-6 sm:grid-cols-2">
            <Card title="Database" actions={<StatusBadge status={data.checks.database.status} />}>
              <p className="text-sm text-muted">
                {data.checks.database.latencyMs !== null
                  ? `Responded in ${data.checks.database.latencyMs} ms.`
                  : 'Not responding.'}
              </p>
            </Card>
            <Card
              title="Database migrations"
              actions={<StatusBadge status={data.checks.migrations.status} />}
            >
              <p className="text-sm text-muted">
                {data.checks.migrations.applied ?? '?'} of {data.checks.migrations.expected}{' '}
                applied.
              </p>
            </Card>
            <Card
              title="File storage"
              actions={<StatusBadge status={data.checks.storage.status} />}
            >
              <p className="text-sm text-muted">
                Driver: {data.checks.storage.driver}. A test file was written and removed.
              </p>
            </Card>
            <Card
              title="Email delivery"
              actions={<StatusBadge status={data.checks.email.status} />}
            >
              <p className="text-sm text-muted">
                No email provider is connected yet. Invitation and password emails are{' '}
                {data.checks.email.transport === 'log'
                  ? 'written to the server log (development only).'
                  : 'not sent.'}
              </p>
            </Card>
            <AuditSealCard seal={data.checks.auditSeal} />
          </div>
        </div>
      )}
    </>
  );
}

/** Tamper-evident audit log (Task D12): the daily seal and the check against the off-site copy. */
function AuditSealCard({ seal }: { seal: SystemHealth['checks']['auditSeal'] }) {
  const status = seal?.status ?? 'not_configured';
  const check = seal?.lastCheck ?? null;
  const last = seal?.lastSeal ?? null;
  return (
    <Card title="Audit log seal" actions={<StatusBadge status={status} />}>
      <div className="space-y-2 text-sm text-muted">
        {status === 'not_configured' && (
          <p>
            Not running here. On the server, a daily job seals the audit log and checks it against
            the off-site copy (docs/operations/audit-seal.md).
          </p>
        )}
        {last && (
          <p>
            Last sealed {formatDateTime(last.ranAt)}
            {last.ok
              ? `: ${last.summary.entries ?? 0} new entries.`
              : `: failed. ${last.summary.problem ?? ''}`}
          </p>
        )}
        {check && (
          <p>
            Last checked {formatDateTime(check.ranAt)}
            {check.ok
              ? `: no unexplained differences in ${check.summary.entriesSealed ?? 0} sealed entries.`
              : `: ${check.summary.problemCount ?? 0} problem(s) found.`}
          </p>
        )}
        {status === 'stale' && <p>The seal or the check has not run for more than 36 hours.</p>}
        {check && !check.ok && (check.summary.problems ?? []).length > 0 && (
          <ul className="list-disc pl-5 text-rose-800">
            {(check.summary.problems ?? []).slice(0, 5).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
