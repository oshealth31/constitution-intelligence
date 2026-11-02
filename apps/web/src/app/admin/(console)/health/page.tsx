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
          </div>
        </div>
      )}
    </>
  );
}
