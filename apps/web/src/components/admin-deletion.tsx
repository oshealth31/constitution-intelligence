'use client';

// Control Centre: deleting an organisation's data (Task D3). Every rule (eligibility, the
// second person or 24-hour wait, the typed address) is enforced by the API; this card explains
// the rules and collects what the API asks for.
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Loading, TextField } from '@/components/ui';
import { useConsoleUser } from '@/app/admin/(console)/console-context';
import { apiFetch, describeError } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface DeletionRequest {
  id: string;
  status: string;
  reason: string;
  requestedBy: { id: string | null; displayName: string | null };
  requestedAt: string;
  expiresAt: string;
  confirmableFrom: string | null;
  approvedBy: { id: string | null; displayName: string | null } | null;
  approvalMode: string | null;
  completedAt: string | null;
  deletedCounts: Record<string, number> | null;
  filesRemoved: boolean;
}

interface DeletionPreview {
  organisation: {
    id: string;
    name: string;
    slug: string;
    status: string;
    deletedAt: string | null;
  };
  eligible: boolean;
  notEligibleReason: string | null;
  willDelete: Record<string, number>;
  auditEvents: number;
  accountsToDelete: number;
  accountsKept: number;
  financialRecordsKept: Record<string, number>;
  activeSuperAdmins: number;
  rule: 'second_person' | 'waiting_period';
  request: DeletionRequest | null;
  lastCompleted: DeletionRequest | null;
}

/** Plain names for the record counts. */
const LABELS: Record<string, string> = {
  constitutions: 'Constitutions',
  constitution_versions: 'Constitution versions',
  sections: 'Clauses',
  files: 'Uploaded files',
  approved_answers: 'Approved answers',
  simplified_sections: 'Simple-words texts',
  ai_conversations: 'AI conversations',
  memberships: 'Members',
  invitations: 'Invitations',
  usage_records: 'Usage records',
  audit_events: 'Audit log entries',
  accounts: 'Accounts deleted (in no other organisation)',
  invoices: 'Invoices',
  payments: 'Payments and receipts',
  subscriptions: 'Subscriptions',
  subscription_events: 'Subscription history entries',
};

const MODES: Record<string, string> = {
  second_person: 'approved by a second Super Admin',
  waiting_period: 'confirmed after the 24-hour wait (only one Super Admin)',
  command_line: 'confirmed on the server command line after the 24-hour wait',
};

function Counts({ counts, keys }: { counts: Record<string, number>; keys?: string[] }) {
  const entries = (keys ?? Object.keys(LABELS))
    .filter((key) => key in counts && LABELS[key])
    .map((key) => [key, counts[key] ?? 0] as const);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted">{LABELS[key]}</dt>
          <dd className="text-right font-medium text-navy-900 tabular-nums">
            {formatNumber(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DeletionCard({
  organisationId,
  onDeleted,
}: {
  organisationId: string;
  onDeleted: () => void | Promise<void>;
}) {
  const me = useConsoleUser();
  const state = useApi<DeletionPreview>(`/platform/organisations/${organisationId}/deletion`);
  const [reason, setReason] = useState('');
  const [exported, setExported] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);

  if (state.error) return <Alert>{describeError(state.error)}</Alert>;
  if (!state.data) {
    return (
      <Card title="Delete this organisation's data">
        <Loading />
      </Card>
    );
  }
  const preview = state.data;
  const base = `/platform/organisations/${organisationId}`;

  async function act(key: string, work: () => Promise<void>) {
    setBusy(key);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setNotice({ tone: 'critical', text: describeError(caught) });
    } finally {
      setBusy(null);
    }
  }

  function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act('request', async () => {
      state.setData(
        await apiFetch<DeletionPreview>(`${base}/deletion-requests`, {
          method: 'POST',
          body: { confirmSlug, reason, exportConfirmed: exported },
        }),
      );
      setConfirmSlug('');
      setNotice({ tone: 'good', text: 'Deletion requested. Nothing has been deleted yet.' });
    });
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = preview.request;
    if (!request) return;
    void act('approve', async () => {
      const result = await apiFetch<{ preview: DeletionPreview; filesRemoved: boolean }>(
        `${base}/deletion-requests/${request.id}/approve`,
        { method: 'POST', body: { confirmSlug } },
      );
      state.setData(result.preview);
      setConfirmSlug('');
      setNotice(
        result.filesRemoved
          ? { tone: 'good', text: 'The organisation’s data has been deleted.' }
          : {
              tone: 'critical',
              text: 'The records were deleted, but removing the files failed. Use “Remove files again”.',
            },
      );
      await onDeleted();
    });
  }

  function cancel() {
    const request = preview.request;
    if (!request) return;
    void act('cancel', async () => {
      state.setData(
        await apiFetch<DeletionPreview>(`${base}/deletion-requests/${request.id}/cancel`, {
          method: 'POST',
        }),
      );
      setNotice({ tone: 'good', text: 'Deletion request cancelled.' });
    });
  }

  function removeFiles() {
    void act('files', async () => {
      const result = await apiFetch<{ filesRemoved: boolean }>(`${base}/deletion/remove-files`, {
        method: 'POST',
      });
      await state.reload();
      setNotice(
        result.filesRemoved
          ? { tone: 'good', text: 'Files removed.' }
          : { tone: 'critical', text: 'Removing the files failed again. Check the server log.' },
      );
    });
  }

  // Already deleted: the record of what happened.
  if (preview.organisation.deletedAt && preview.lastCompleted) {
    const done = preview.lastCompleted;
    return (
      <Card
        title="Data deleted"
        description="What was deleted, and by whom. Invoices, payments, receipts and the subscription history are kept as financial records."
      >
        {notice && (
          <div className="mb-4">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
        )}
        <p className="text-sm text-ink">
          Deleted {formatDateTime(done.completedAt)}. Requested by{' '}
          {done.requestedBy.displayName ?? 'a former Super Admin'};{' '}
          {MODES[done.approvalMode ?? ''] ?? done.approvalMode}
          {done.approvalMode === 'second_person' && done.approvedBy?.displayName
            ? ` (${done.approvedBy.displayName})`
            : ''}
          .
        </p>
        <p className="mt-2 text-sm text-muted">Reason: {done.reason}</p>
        <div className="mt-4">
          <Counts counts={done.deletedCounts ?? {}} />
        </div>
        <p className="mt-4 text-sm text-muted">
          The data remains inside encrypted backups until they expire (35 days by default).
        </p>
        {!done.filesRemoved && (
          <div className="mt-4 space-y-2">
            <Alert>The organisation’s files have not been removed from storage yet.</Alert>
            <Button variant="danger" busy={busy === 'files'} onClick={removeFiles}>
              Remove files again
            </Button>
          </div>
        )}
      </Card>
    );
  }

  const request = preview.request;
  const ruleText =
    preview.rule === 'second_person'
      ? 'There are two or more Super Admins, so a different Super Admin must approve the request.'
      : 'You are the only Super Admin, so you can confirm the request yourself 24 hours after making it, or cancel it before then.';
  const isRequester = request?.requestedBy.id === me.id;
  const waitingUntil =
    request?.confirmableFrom && Date.parse(request.confirmableFrom) > Date.now()
      ? request.confirmableFrom
      : null;
  const blockedByRule = preview.rule === 'second_person' ? isRequester : Boolean(waitingUntil);

  return (
    <Card
      title="Delete this organisation's data"
      description="Permanent. For an organisation that has left, after its data was exported (or its owner declined an export)."
    >
      <div className="space-y-4">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy-900">Will be deleted</h3>
            <Counts
              counts={{
                ...preview.willDelete,
                audit_events: preview.auditEvents,
                accounts: preview.accountsToDelete,
              }}
              keys={[
                'constitutions',
                'constitution_versions',
                'sections',
                'files',
                'approved_answers',
                'simplified_sections',
                'ai_conversations',
                'memberships',
                'invitations',
                'audit_events',
                'accounts',
              ]}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy-900">Kept (financial records)</h3>
            <Counts counts={preview.financialRecordsKept} />
            <p className="mt-2 text-xs text-muted">
              {preview.accountsKept} member account(s) are kept because they belong to another
              organisation or are staff; only their membership here is removed.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted">{ruleText}</p>

        {!preview.eligible && <Alert tone="info">{preview.notEligibleReason}</Alert>}

        {preview.eligible && !request && (
          <form onSubmit={requestDeletion} className="space-y-3" aria-label="Request deletion">
            <TextField
              label="Reason"
              hint="At least 10 characters, for example “Pilot ended; owner asked in writing on 3 Nov”. Do not include members’ names."
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <label className="flex items-start gap-2 text-sm text-navy-900">
              <input
                type="checkbox"
                className="mt-1"
                checked={exported}
                onChange={(event) => setExported(event.target.checked)}
              />
              The organisation’s data was exported and handed over, or its owner declined an export
              in writing.
            </label>
            <TextField
              label={`Type the web address “${preview.organisation.slug}” to confirm`}
              required
              autoComplete="off"
              spellCheck={false}
              value={confirmSlug}
              onChange={(event) => setConfirmSlug(event.target.value)}
            />
            <Button
              type="submit"
              variant="danger"
              busy={busy === 'request'}
              disabled={!exported || confirmSlug !== preview.organisation.slug}
            >
              Request deletion
            </Button>
          </form>
        )}

        {request && (
          <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm text-rose-900">
              <strong>Deletion requested</strong> by{' '}
              {request.requestedBy.displayName ?? 'a Super Admin'} on{' '}
              {formatDateTime(request.requestedAt)}. Reason: {request.reason}. The request expires{' '}
              {formatDateTime(request.expiresAt)}.
            </p>
            {preview.rule === 'second_person' && isRequester && (
              <p className="text-sm text-rose-900">
                Waiting for another Super Admin to approve it.
              </p>
            )}
            {waitingUntil && (
              <p className="text-sm text-rose-900">
                It can be confirmed from {formatDateTime(waitingUntil)}.
              </p>
            )}
            {!blockedByRule && (
              <form onSubmit={approve} className="space-y-3" aria-label="Approve deletion">
                <TextField
                  label={`Type the web address “${preview.organisation.slug}” to delete permanently`}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmSlug}
                  onChange={(event) => setConfirmSlug(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="danger"
                  busy={busy === 'approve'}
                  disabled={confirmSlug !== preview.organisation.slug}
                >
                  Delete permanently
                </Button>
              </form>
            )}
            <Button variant="secondary" busy={busy === 'cancel'} onClick={cancel}>
              Cancel the request
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
