'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  SelectField,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { describeError, type AuditEventItem } from '@/lib/api';
import { actionLabel, describeAuditDetails, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const AREAS = [
  { value: '', label: 'All events' },
  { value: 'auth', label: 'Sign-in and passwords' },
  { value: 'organisation', label: 'Organisations' },
  { value: 'subscription', label: 'Subscriptions' },
  { value: 'membership', label: 'Memberships' },
  { value: 'invitation', label: 'Invitations' },
  { value: 'user', label: 'Accounts' },
  { value: 'support', label: 'Support content access' },
  { value: 'permission', label: 'Permission refusals' },
];

function AuditDetails({ metadata }: { metadata: Record<string, unknown> }) {
  const lines = describeAuditDetails(metadata);
  if (lines.length === 0) return <span>—</span>;
  return (
    <ul className="space-y-0.5">
      {lines.map((line, index) => (
        <li key={index} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

function AuditLog() {
  const initialOrganisation = useSearchParams().get('organisationId') ?? '';
  const [organisationId, setOrganisationId] = useState(initialOrganisation);
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [applied, setApplied] = useState({
    organisationId: initialOrganisation,
    action: '',
    outcome: '',
  });

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '200' });
    if (applied.organisationId) params.set('organisationId', applied.organisationId);
    if (applied.action) params.set('action', applied.action);
    if (applied.outcome) params.set('outcome', applied.outcome);
    return `/platform/audit-events?${params.toString()}`;
  }, [applied]);
  const events = useApi<AuditEventItem[]>(path);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, permission decisions and every privileged change. Entries cannot be edited or deleted."
      />
      <Card>
        <form
          method="post"
          className="mb-5 grid gap-3 md:grid-cols-[1fr_220px_160px_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ organisationId: organisationId.trim(), action, outcome });
          }}
        >
          <TextField
            label="Organisation ID"
            placeholder="All organisations"
            value={organisationId}
            onChange={(event) => setOrganisationId(event.target.value)}
          />
          <SelectField
            label="Area"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            options={AREAS}
          />
          <SelectField
            label="Outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            options={[
              { value: '', label: 'Any' },
              { value: 'success', label: 'Success' },
              { value: 'failure', label: 'Failure' },
              { value: 'denied', label: 'Denied' },
            ]}
          />
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
        </form>

        {events.error ? <Alert>{describeError(events.error)}</Alert> : null}
        {events.loading && !events.data ? <Loading /> : null}
        {events.data && events.data.length === 0 && (
          <EmptyState>No events match these filters.</EmptyState>
        )}
        {events.data && events.data.length > 0 && (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-ivory-100 text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium sm:px-6">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    By
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Organisation
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ivory-100">
                {events.data.map((event) => (
                  <tr key={event.id} className="align-top">
                    <td className="px-5 py-2 whitespace-nowrap text-muted sm:px-6">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="px-3 py-2 font-medium text-navy-900">
                      {actionLabel(event.action)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={event.outcome} />
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {event.actorEmail ?? 'System / anonymous'}
                    </td>
                    <td className="px-3 py-2">
                      {event.organisationId ? (
                        <Link
                          href={`/admin/organisations/${event.organisationId}`}
                          className="text-navy-900 hover:underline"
                        >
                          {event.organisationName ?? event.organisationId}
                        </Link>
                      ) : (
                        <span className="text-muted">Platform</span>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs text-muted">
                      <AuditDetails metadata={event.metadata} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuditLog />
    </Suspense>
  );
}
