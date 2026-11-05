'use client';

import { useState, type ChangeEvent } from 'react';
import { clauseTitle } from '@/components/approved-answer';
import { Badge } from '@/components/ui';
import { Notice, Panel, PortalButton, PortalLoading, PortalField } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  can,
  parseSimpleImport,
  SIMPLE_STATUS,
  type LinkedClause,
  type ManagedSimple,
  type SimpleImportRow,
  type SimpleOverview,
} from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

type Filter = 'all' | 'missing' | 'to_approve' | 'approved';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All clauses' },
  { value: 'missing', label: 'No simple words yet' },
  { value: 'to_approve', label: 'Waiting for approval' },
  { value: 'approved', label: 'Approved' },
];

const EXAMPLE = `{
  "items": [
    {
      "clause": "7",
      "text": "At least one third of members must be there for a general meeting to make decisions.",
      "draftedBy": "ai"
    }
  ]
}`;

/** Simple words: a plain-language version of each clause, approved before members see it. */
export default function SimpleWordsPage() {
  const { api } = usePortal();
  const overview = useApi<SimpleOverview>(`${api}/manage/simple-words`);
  const [filter, setFilter] = useState<Filter>('all');

  if (overview.loading && !overview.data) return <PortalLoading />;
  if (!overview.data) return <Notice tone="error">{describeError(overview.error)}</Notice>;

  const all = overview.data.constitutions.flatMap((item) => item.clauses);
  const counts = {
    approved: all.filter((item) => item.simple?.status === 'approved').length,
    waiting: all.filter((item) => item.simple && item.simple.status !== 'approved').length,
  };

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-base text-slate-600">
        Write each clause again in simple, everyday words for members who find legal wording hard.
        Members see simple words under the original clause — never instead of it — once an owner or
        administrator has <strong>approved</strong> them. Only the current published version can
        have simple words.
      </p>
      <p className="text-base text-slate-800">
        {counts.approved} of {all.length} clauses have approved simple words
        {counts.waiting > 0 ? `; ${counts.waiting} waiting for approval` : ''}.
      </p>

      <ImportPanel onImported={overview.reload} />

      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={`min-h-11 rounded-full px-4 text-base font-medium ring-1 ring-inset ${
              filter === item.value
                ? 'bg-[var(--brand-primary)] text-[var(--brand-on-primary)] ring-transparent'
                : 'bg-white text-slate-800 ring-slate-300'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {overview.data.constitutions.length === 0 && (
        <Notice>No constitution has been published yet.</Notice>
      )}
      {overview.data.constitutions.map((constitution) => {
        const shown = constitution.clauses.filter(({ simple }) =>
          filter === 'all'
            ? true
            : filter === 'missing'
              ? !simple
              : filter === 'approved'
                ? simple?.status === 'approved'
                : simple !== null && simple.status !== 'approved',
        );
        return (
          <Panel
            key={constitution.versionId}
            title={constitution.title}
            description={`Version ${constitution.versionNumber}: ${constitution.versionLabel}`}
          >
            {shown.length === 0 && <p className="text-base text-slate-600">Nothing to show.</p>}
            <ol className="space-y-4">
              {shown.map(({ clause, simple }) => (
                <ClauseEditor
                  key={`${clause.sectionId}-${simple?.updatedAt ?? 'none'}`}
                  clause={clause}
                  initial={simple}
                />
              ))}
            </ol>
          </Panel>
        );
      })}
    </div>
  );
}

function ClauseEditor({
  clause,
  initial,
}: {
  clause: LinkedClause;
  initial: ManagedSimple | null;
}) {
  const { api, home } = usePortal();
  const canApprove = can(home.you.permissions, 'content.approve');
  const [simple, setSimple] = useState<ManagedSimple | null>(initial);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial?.text ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = clauseTitle(clause);
  const base = `${api}/manage/simple-words/sections/${clause.sectionId}`;

  async function run(name: string, work: () => Promise<ManagedSimple | null>) {
    setBusy(name);
    setError(null);
    try {
      const next = await work();
      setSimple(next);
      setText(next?.text ?? '');
      setConfirmed(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li
      aria-label={`Simple words for ${clause.referenceLabel ?? title}`}
      className="rounded-2xl border border-slate-200 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-[var(--brand-ink)]">{title}</p>
        {clause.referenceLabel && clause.referenceLabel !== title && (
          <span className="text-sm text-slate-600">{clause.referenceLabel}</span>
        )}
        {simple ? (
          <Badge tone={SIMPLE_STATUS[simple.status].tone}>
            {SIMPLE_STATUS[simple.status].label}
          </Badge>
        ) : (
          <Badge tone="neutral">No simple words yet</Badge>
        )}
        {simple?.source === 'ai' && <Badge tone="warning">Drafted by AI</Badge>}
      </div>
      <blockquote className="mt-2 border-l-4 border-slate-300 pl-3 text-base whitespace-pre-line text-slate-800">
        <span className="sr-only">Original text: </span>
        {clause.text}
      </blockquote>

      {simple?.reviewReason && (
        <div className="mt-3">
          <Notice tone="warning">{simple.reviewReason}</Notice>
        </div>
      )}

      {editing ? (
        <form
          method="post"
          aria-label={`Write simple words for ${clause.referenceLabel ?? title}`}
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run('save', async () => {
              const saved = await apiFetch<ManagedSimple>(base, { method: 'PUT', body: { text } });
              setEditing(false);
              return saved;
            });
          }}
        >
          {simple?.status === 'approved' && (
            <Notice tone="warning">
              Saving changes hides these simple words from members until they are approved again.
            </Notice>
          )}
          <PortalField
            label={<>Simple words</>}
            hint={
              <>
                Short sentences and everyday words. Say only what the clause says — add nothing,
                leave out nothing important.
              </>
            }
          >
            {(field) => (
              <>
                <textarea
                  {...field}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={4}
                  maxLength={3000}
                  required
                  className={FIELD}
                />
              </>
            )}
          </PortalField>
          <div className="flex flex-wrap gap-3">
            <PortalButton type="submit" busy={busy === 'save'}>
              Save as draft
            </PortalButton>
            <PortalButton
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setText(simple?.text ?? '');
              }}
            >
              Cancel
            </PortalButton>
          </div>
        </form>
      ) : (
        simple && (
          <div className="mt-3 rounded-xl bg-[var(--brand-secondary)]/40 p-3">
            <p className="text-sm font-semibold text-slate-700">Simple words</p>
            <p
              data-testid="simple-text"
              className="mt-1 text-base whitespace-pre-line text-slate-900"
            >
              {simple.text}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Last changed {formatDate(simple.updatedAt)}
              {simple.updatedBy ? ` by ${simple.updatedBy}` : ''}
              {simple.approvedBy && simple.approvedAt
                ? ` · approved by ${simple.approvedBy} on ${formatDate(simple.approvedAt)}`
                : ''}
            </p>
          </div>
        )
      )}

      {simple && !editing && simple.status !== 'approved' && simple.issues.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Check results">
          {simple.issues.map((issue) => (
            <li key={issue.message}>
              <Notice tone={issue.blocking ? 'error' : 'warning'}>
                {issue.blocking && <strong>Must be fixed: </strong>}
                {issue.message}
              </Notice>
            </li>
          ))}
        </ul>
      )}

      {simple &&
        !editing &&
        simple.status !== 'approved' &&
        canApprove &&
        simple.readyToApprove && (
          <div className="mt-3 space-y-2">
            {simple.source === 'ai' && (
              <Notice tone="warning">
                Written by AI. AI can misread or invent things: check every sentence against the
                original above.
              </Notice>
            )}
            <label className="flex items-start gap-3 text-base text-slate-900">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 size-5"
              />
              <span>
                I have read these simple words against the original clause. They say nothing the
                clause does not say.
              </span>
            </label>
          </div>
        )}
      {simple && !editing && simple.status !== 'approved' && !canApprove && (
        <p className="mt-3 text-sm text-slate-600">
          An owner or administrator needs to approve these simple words before members see them.
        </p>
      )}

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <PortalButton
            variant={simple ? 'secondary' : 'primary'}
            className="min-h-11 py-2"
            onClick={() => setEditing(true)}
          >
            {simple ? 'Edit' : 'Write simple words'}
          </PortalButton>
          {simple && simple.status !== 'approved' && canApprove && simple.readyToApprove && (
            <PortalButton
              className="min-h-11 py-2"
              disabled={!confirmed}
              busy={busy === 'approve'}
              onClick={() =>
                void run('approve', () =>
                  apiFetch<ManagedSimple>(`${base}/approve`, {
                    method: 'POST',
                    body: { confirmed: true },
                  }),
                )
              }
            >
              Approve
            </PortalButton>
          )}
          {simple?.status === 'approved' && canApprove && (
            <PortalButton
              variant="secondary"
              className="min-h-11 py-2"
              busy={busy === 'withdraw'}
              onClick={() =>
                void run('withdraw', () =>
                  apiFetch<ManagedSimple>(`${base}/withdraw`, { method: 'POST', body: {} }),
                )
              }
            >
              Withdraw
            </PortalButton>
          )}
          {simple && simple.status !== 'approved' && (
            <PortalButton
              variant="quiet"
              className="min-h-11 py-2"
              busy={busy === 'delete'}
              onClick={() => {
                if (window.confirm('Delete these simple words?')) {
                  void run('delete', async () => {
                    await apiFetch(base, { method: 'DELETE' });
                    return null;
                  });
                }
              }}
            >
              Delete
            </PortalButton>
          )}
        </div>
      )}
    </li>
  );
}

function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
  const { api } = usePortal();
  const [rows, setRows] = useState<SimpleImportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows(null);
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('The file is too large. Import at most 500 clauses at a time.');
      return;
    }
    const parsed = parseSimpleImport(await file.text());
    if ('error' in parsed) setError(parsed.error);
    else setRows(parsed.rows);
  }

  async function importRows() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const report = await apiFetch<{
        saved: unknown[];
        skipped: { clause: string; reason: string }[];
      }>(`${api}/manage/simple-words/import`, { method: 'POST', body: { items: rows } });
      setResult(
        `${report.saved.length} saved as ${report.saved.length === 1 ? 'a draft' : 'drafts'}. Nothing has been approved.${
          report.skipped.length > 0
            ? ` Skipped: ${report.skipped.map((item) => `${item.clause} (${item.reason})`).join('; ')}`
            : ''
        }`,
      );
      setRows(null);
      await onImported();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Import simple words from a file"
      description="For simple words prepared outside the platform (for example drafted with AI). Imported text is always a draft."
    >
      <label className="block text-base font-medium text-slate-900">
        Choose a .json file
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => void choose(event)}
          className="mt-2 block w-full text-base"
        />
      </label>
      {rows && (
        <div className="mt-3 space-y-3">
          <p className="text-base text-slate-800">
            The file has simple words for {rows.length} {rows.length === 1 ? 'clause' : 'clauses'}.
          </p>
          <PortalButton busy={busy} onClick={() => void importRows()}>
            Import as drafts
          </PortalButton>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {result && (
        <div className="mt-3">
          <Notice tone="success">{result}</Notice>
        </div>
      )}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer text-base font-medium text-[var(--brand-ink)]">
          File format
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
          {EXAMPLE}
        </pre>
      </details>
    </Panel>
  );
}
