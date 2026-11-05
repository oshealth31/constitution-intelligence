'use client';

// Control Centre: one person's requests about their own personal data (Task D11).
// The rules are enforced by the API; this page records requests and lists them.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import {
  KIND_LABELS,
  type DataRequestDetail,
  type DataRequestKind,
  type DataRequestRow,
} from '@/lib/data-requests';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const today = () => new Date().toISOString().slice(0, 10);

function StatusLabel({ row }: { row: DataRequestRow }) {
  if (row.status === 'completed') return <Badge tone="good">Completed</Badge>;
  if (row.status === 'cancelled') return <Badge>Cancelled</Badge>;
  return row.overdue ? <Badge tone="critical">Overdue</Badge> : <Badge tone="info">Open</Badge>;
}

export default function DataRequestsPage() {
  const router = useRouter();
  const list = useApi<DataRequestRow[]>('/platform/data-requests');
  const [kind, setKind] = useState<DataRequestKind>('copy');
  const [email, setEmail] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const [respondBy, setRespondBy] = useState('');
  const [receivedVia, setReceivedVia] = useState('');
  const [identityCheck, setIdentityCheck] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    void apiFetch<DataRequestDetail>('/platform/data-requests', {
      method: 'POST',
      body: {
        kind,
        email,
        receivedOn,
        respondBy,
        receivedVia,
        identityCheck,
        details: details || undefined,
      },
    })
      .then((created) => router.push(`/admin/data-requests/${created.request.id}`))
      .catch((caught: unknown) => {
        setError(describeError(caught));
        setBusy(false);
      });
  }

  return (
    <>
      <PageHeader
        title="Data requests"
        description="A person asking for a copy of their data, a correction, or deletion of their account. Record each request here so none is missed, then act on it from its page."
      />
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Requests">
          {list.error ? <Alert>{describeError(list.error)}</Alert> : null}
          {!list.data && !list.error ? <Loading /> : null}
          {list.data && list.data.length === 0 && <EmptyState>No requests yet.</EmptyState>}
          {list.data && list.data.length > 0 && (
            <ul className="divide-y divide-ivory-100">
              {list.data.map((row) => (
                <li key={row.id} className="py-3" data-testid="data-request">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/data-requests/${row.id}`}
                      className="font-medium break-all text-navy-900 hover:underline"
                    >
                      {row.subjectEmail}
                    </Link>
                    <StatusLabel row={row} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {KIND_LABELS[row.kind]} · received {formatDate(row.receivedOn)} · respond by{' '}
                    {formatDate(row.respondBy)}
                    {row.hasAccount ? '' : ' · no account found'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Record a new request"
          description="Confirm who is asking before you record it: for example call them back on a number you already have, or have their organisation's Owner confirm in writing."
        >
          <form
            method="post"
            onSubmit={submit}
            className="space-y-4"
            aria-label="Record a data request"
          >
            {error && <Alert>{error}</Alert>}
            <SelectField
              label="What they ask for"
              value={kind}
              onChange={(event) => setKind(event.target.value as DataRequestKind)}
              options={[
                { value: 'copy', label: KIND_LABELS.copy },
                { value: 'correction', label: 'Correction of their name or email' },
                { value: 'deletion', label: 'Deletion of their account' },
              ]}
            />
            <TextField
              label="Their email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Date received"
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
                required
              />
              <TextField
                label="Respond by"
                hint="The deadline you have confirmed applies."
                type="date"
                value={respondBy}
                min={receivedOn}
                onChange={(event) => setRespondBy(event.target.value)}
                required
              />
            </div>
            <TextField
              label="How it arrived"
              hint="For example: email from the person; letter via the organisation's Owner."
              value={receivedVia}
              onChange={(event) => setReceivedVia(event.target.value)}
              required
              minLength={3}
              maxLength={200}
            />
            <TextField
              label="How you confirmed it is them"
              value={identityCheck}
              onChange={(event) => setIdentityCheck(event.target.value)}
              required
              minLength={10}
              maxLength={500}
            />
            <TextField
              label="Details (optional)"
              hint="For a correction: what is wrong and what it should be."
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={2000}
            />
            <Button type="submit" busy={busy}>
              Record the request
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
