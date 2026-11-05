'use client';

// Control Centre: one personal data request (Task D11) and the action it needs.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import { KIND_LABELS, OUTCOME_LABELS, type DataRequestDetail } from '@/lib/data-requests';
import { formatDate, formatDateTime, roleLabel } from '@/lib/format';
import { useApi } from '@/lib/use-api';

function Outcome({ outcome }: { outcome: Record<string, unknown> }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {Object.entries(outcome).map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted">{OUTCOME_LABELS[key] ?? key}</dt>
          <dd className="text-right font-medium break-words text-navy-900">
            {Array.isArray(value) ? value.join(', ') : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DataRequestPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const base = `/platform/data-requests/${requestId}`;
  const state = useApi<DataRequestDetail>(base);
  const [reason, setReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [note, setNote] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);

  if (state.error) return <Alert>{describeError(state.error)}</Alert>;
  if (!state.data) return <Loading />;
  const { request, subject } = state.data;
  const open = request.status === 'open';

  function act(key: string, path: string, body: unknown, done: string) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(key);
      setNotice(null);
      void apiFetch<DataRequestDetail>(`${base}/${path}`, { method: 'POST', body })
        .then((result) => {
          state.setData(result);
          setReason('');
          setNotice({ tone: 'good', text: done });
        })
        .catch((caught: unknown) => setNotice({ tone: 'critical', text: describeError(caught) }))
        .finally(() => setBusy(null));
    };
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/data-requests" className="text-teal-600 hover:underline">
          ← Data requests
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {KIND_LABELS[request.kind]}
            {request.status === 'completed' && <Badge tone="good">Completed</Badge>}
            {request.status === 'cancelled' && <Badge>Cancelled</Badge>}
            {open && <Badge tone="info">Open</Badge>}
          </span>
        }
        description={`Respond by ${formatDate(request.respondBy)}`}
      />
      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="The request">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium text-navy-900">Person</dt>
              <dd className="break-all">{request.subjectEmail}</dd>
            </div>
            <div>
              <dt className="font-medium text-navy-900">Received</dt>
              <dd>
                {formatDate(request.receivedOn)} · {request.receivedVia}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-navy-900">Identity confirmed by</dt>
              <dd>{request.identityCheck}</dd>
            </div>
            {request.details && (
              <div>
                <dt className="font-medium text-navy-900">Details</dt>
                <dd className="whitespace-pre-line">{request.details}</dd>
              </div>
            )}
            <div>
              <dt className="font-medium text-navy-900">Recorded</dt>
              <dd>
                {formatDateTime(request.createdAt)}
                {request.createdBy ? ` by ${request.createdBy}` : ''}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Their account">
          {!subject.hasAccount ? (
            <p className="text-sm text-muted">
              {request.subjectEmail === '[removed]'
                ? 'The account was deleted.'
                : 'No account uses this email address. Tell the person that no account data is held under it.'}
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium text-navy-900">{subject.displayName}</span>
                {subject.isSuperAdmin ? ' · Super Admin' : ''}
              </p>
              {subject.organisations.length === 0 ? (
                <p className="text-muted">Not a member of any organisation.</p>
              ) : (
                <ul className="list-disc pl-5">
                  {subject.organisations.map((organisation) => (
                    <li key={organisation.id}>
                      {organisation.name} — {roleLabel(organisation.role)}
                      {organisation.status !== 'active' ? ` (${organisation.status})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {open && subject.hasAccount && (
          <Card
            title="Copy of their data"
            description="A file with everything held about this person: account, organisations, sign-ins and devices, invitations, AI questions and feedback, activity log, and what they uploaded or approved. Passwords and secret keys are never included. Each download is recorded."
          >
            <a
              href={`/api/v1${base}/copy`}
              // Safari shows JSON on screen even when the server says "download"; this attribute
              // makes every browser save it as a file (found by the WebKit tests, task T1).
              download={`personal-data-${request.id.slice(0, 8)}.json`}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700"
            >
              Download the copy
            </a>
            {request.kind === 'copy' && (
              <form
                method="post"
                onSubmit={act('complete', 'complete', { note }, 'Request marked as answered.')}
                className="mt-4 space-y-2"
              >
                <TextField
                  label="When you have sent it: how it was sent"
                  hint="For example: emailed as an encrypted attachment on 5 Nov."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  required
                  minLength={3}
                  maxLength={1000}
                />
                <Button type="submit" variant="secondary" busy={busy === 'complete'}>
                  Mark as answered
                </Button>
              </form>
            )}
          </Card>
        )}

        {open && subject.hasAccount && request.kind === 'correction' && (
          <Card
            title="Correct their details"
            description="Leave a field empty to keep it. A new email address signs them out everywhere, so they sign in again with it."
          >
            <form
              method="post"
              onSubmit={act(
                'correct',
                'correct',
                {
                  displayName: newName.trim() || undefined,
                  email: newEmail.trim() || undefined,
                  reason,
                },
                'Details corrected. The request is completed.',
              )}
              className="space-y-3"
            >
              <TextField
                label="Correct name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={120}
              />
              <TextField
                label="Correct email address"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
              <TextField
                label="Reason (recorded in the audit log)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={10}
                maxLength={500}
              />
              <Button type="submit" busy={busy === 'correct'}>
                Save the correction
              </Button>
            </form>
          </Card>
        )}

        {open && subject.hasAccount && request.kind === 'deletion' && (
          <Card
            title="Delete their account"
            description="Permanent. Deletes the account, sign-ins, two-step sign-in, reset links, invitations to this address, and their AI questions and feedback. Constitution versions, approvals, answers and payment records stay, without their name. Audit entries stay but lose their IP address, device, name and email."
          >
            {subject.deletionBlockers.length > 0 ? (
              <div className="space-y-2">
                {subject.deletionBlockers.map((blocker) => (
                  <Alert key={blocker}>{blocker}</Alert>
                ))}
              </div>
            ) : (
              <form
                method="post"
                onSubmit={act(
                  'delete',
                  'delete-person',
                  { confirmEmail, reason },
                  'The account was deleted. The request is completed.',
                )}
                className="space-y-3"
              >
                <TextField
                  label="Reason (recorded in the audit log)"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={10}
                  maxLength={500}
                />
                <TextField
                  label={`Type ${request.subjectEmail} to confirm`}
                  value={confirmEmail}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                  required
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  variant="danger"
                  busy={busy === 'delete'}
                  disabled={confirmEmail.trim().toLowerCase() !== request.subjectEmail}
                >
                  Delete the account permanently
                </Button>
                <p className="text-xs text-muted">
                  Backups keep the data until they expire (35 days by default). Copies already
                  downloaded cannot be recalled.
                </p>
              </form>
            )}
          </Card>
        )}

        {request.status === 'completed' && (
          <Card title="Outcome">
            <p className="mb-3 text-sm">
              Completed {formatDateTime(request.completedAt)}
              {request.completedBy ? ` by ${request.completedBy}` : ''}.
            </p>
            {request.outcome && <Outcome outcome={request.outcome} />}
          </Card>
        )}
        {request.status === 'cancelled' && (
          <Card title="Cancelled">
            <p className="text-sm">
              {formatDateTime(request.cancelledAt)}: {request.cancelReason}
            </p>
          </Card>
        )}

        {open && (
          <Card title="Cancel this request" description="For example if the person withdrew it.">
            <form
              method="post"
              onSubmit={act('cancel', 'cancel', { reason: cancelReason }, 'Request cancelled.')}
              className="space-y-3"
            >
              <TextField
                label="Reason for cancelling"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                required
                minLength={10}
                maxLength={500}
              />
              <Button type="submit" variant="secondary" busy={busy === 'cancel'}>
                Cancel the request
              </Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
