'use client';

import Link from 'next/link';
import { Alert, Card, EmptyState, Loading, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { describeError, type Overview, type StatusCount, type SystemHealth } from '@/lib/api';
import { formatDate, formatMetric, formatNumber, metricLabel, statusLabel } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useConsoleUser } from './console-context';

function Breakdown({ items, empty }: { items: StatusCount[]; empty: string }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.status}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-navy-900">{statusLabel(item.status)}</span>
            <span className="font-medium tabular-nums text-navy-900">{formatNumber(item.count)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-ivory-100">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.round((item.count / total) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function OverviewPage() {
  const user = useConsoleUser();
  const overview = useApi<Overview>('/platform/overview');
  const health = useApi<SystemHealth>('/platform/health');

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Welcome back, ${user.displayName}. Live figures from the platform database.`}
      />
      {overview.error ? <Alert>{describeError(overview.error)}</Alert> : null}
      {overview.loading && !overview.data ? <Loading /> : null}
      {overview.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Organisations"
              value={formatNumber(overview.data.totals.organisationsTotal)}
              hint={`${formatNumber(overview.data.totals.organisationsActive)} active · ${formatNumber(overview.data.totals.organisationsSuspended)} suspended`}
            />
            <Stat
              label="People"
              value={formatNumber(overview.data.totals.usersActive)}
              hint={`${formatNumber(overview.data.totals.activeMemberships)} active memberships`}
            />
            <Stat
              label="Constitutions"
              value={formatNumber(overview.data.totals.constitutions)}
              hint={`${formatNumber(overview.data.totals.pendingInvitations)} invitations pending`}
            />
            <Stat
              label="Failed sign-ins (24h)"
              value={formatNumber(overview.data.totals.failedLogins24h)}
              tone={overview.data.totals.failedLogins24h > 20 ? 'warning' : undefined}
              hint={`${formatNumber(overview.data.totals.auditEvents24h)} audit events in 24h`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Subscriptions" description="Current subscription of each organisation.">
              <Breakdown items={overview.data.subscriptionsByStatus} empty="No subscriptions yet." />
            </Card>
            <Card title="Constitution processing" description="Versions by stage, all organisations.">
              <Breakdown items={overview.data.versionsByStatus} empty="No constitutions uploaded yet." />
            </Card>
            <Card title="Usage (30 days)" description="Recorded platform usage.">
              {overview.data.usage30d.length === 0 ? (
                <EmptyState>No usage recorded yet.</EmptyState>
              ) : (
                <dl className="space-y-3">
                  {overview.data.usage30d.map((item) => (
                    <div key={item.metric} className="flex items-center justify-between text-sm">
                      <dt className="text-navy-900">{metricLabel(item.metric)}</dt>
                      <dd className="font-medium tabular-nums text-navy-900">
                        {formatMetric(item.metric, item.total)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              title="Newest organisations"
              className="lg:col-span-2"
              actions={
                <Link href="/admin/organisations" className="text-sm font-medium text-teal-600 hover:underline">
                  All organisations
                </Link>
              }
            >
              {overview.data.recentOrganisations.length === 0 ? (
                <EmptyState>No organisations yet.</EmptyState>
              ) : (
                <ul className="divide-y divide-ivory-100">
                  {overview.data.recentOrganisations.map((organisation) => (
                    <li key={organisation.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/organisations/${organisation.id}`}
                          className="block truncate text-sm font-medium text-navy-900 hover:underline"
                        >
                          {organisation.name}
                        </Link>
                        <p className="text-xs text-muted">
                          {organisation.slug} · created {formatDate(organisation.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={organisation.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card
              title="System health"
              actions={
                <Link href="/admin/health" className="text-sm font-medium text-teal-600 hover:underline">
                  Details
                </Link>
              }
            >
              {health.error ? <Alert>{describeError(health.error)}</Alert> : null}
              {health.data ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-navy-900">Overall</span>
                    <StatusBadge status={health.data.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-navy-900">Database</span>
                    <StatusBadge status={health.data.checks.database.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-navy-900">Migrations</span>
                    <StatusBadge status={health.data.checks.migrations.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-navy-900">File storage</span>
                    <StatusBadge status={health.data.checks.storage.status} />
                  </div>
                </div>
              ) : (
                !health.error && <Loading />
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
