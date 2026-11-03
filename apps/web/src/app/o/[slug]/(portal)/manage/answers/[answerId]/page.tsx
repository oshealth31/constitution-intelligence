'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { OriginalClause } from '@/components/approved-answer';
import { Badge } from '@/components/ui';
import { BackLink, Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  ANSWER_STATUS,
  answerSourceLabel,
  can,
  portalPath,
  splitClauseReferences,
  type ManagedAnswer,
} from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

/**
 * One answer: the everyday-words answer next to the original clauses it relies on, the automatic
 * checks, editing, and (for owners and administrators) approval.
 */
export default function AnswerReviewPage() {
  const { answerId } = useParams<{ answerId: string }>();
  const { api, slug, home } = usePortal();
  const router = useRouter();
  const loaded = useApi<ManagedAnswer>(`${api}/manage/answers/${answerId}`);
  const canApprove = can(home.you.permissions, 'content.approve');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loaded.loading && !loaded.data) return <PortalLoading />;
  if (!loaded.data) {
    return (
      <div>
        <BackLink href={portalPath(slug, '/manage/answers')}>All answers</BackLink>
        <Notice tone="error">{describeError(loaded.error)}</Notice>
      </div>
    );
  }
  const answer = loaded.data;
  const status = ANSWER_STATUS[answer.status];
  const blocking = answer.issues.filter((issue) => issue.blocking);
  const warnings = answer.issues.filter((issue) => !issue.blocking);

  async function act(name: string, path: string, method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(name);
    setError(null);
    try {
      if (method === 'DELETE') {
        await apiFetch(`${api}/manage/answers/${answerId}`, { method });
        router.push(portalPath(slug, '/manage/answers'));
        return;
      }
      loaded.setData(
        await apiFetch<ManagedAnswer>(`${api}/manage/answers/${answerId}/${path}`, {
          method,
          body: body ?? {},
        }),
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <BackLink href={portalPath(slug, '/manage/answers')}>All answers</BackLink>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-900">{answer.question}</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {status.help} {answerSourceLabel(answer)}. Last changed {formatDate(answer.updatedAt)}
          {answer.updatedBy ? ` by ${answer.updatedBy}` : ''}.
          {answer.approvedBy && answer.approvedAt
            ? ` Approved by ${answer.approvedBy} on ${formatDate(answer.approvedAt)}.`
            : ''}
        </p>
      </div>

      {answer.source === 'ai' && answer.status !== 'approved' && (
        <Notice tone="warning">
          <strong>This draft was written by AI.</strong> AI can misread or invent things. Check
          every sentence against the original clauses below before approving it.
        </Notice>
      )}
      {answer.reviewReason && <Notice tone="warning">{answer.reviewReason}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Answer in everyday words">
          <p
            data-testid="managed-answer-text"
            className="text-lg whitespace-pre-line text-slate-900"
          >
            {answer.answer}
          </p>
          {answer.status !== 'retired' && (
            <EditForm answer={answer} onSaved={(saved) => loaded.setData(saved)} />
          )}
        </Panel>
        <Panel
          title="Original clauses"
          description="Exactly as written in the constitution. The answer must say nothing these clauses do not."
        >
          {answer.clauses.length === 0 ? (
            <Notice tone="warning">No clauses are linked yet.</Notice>
          ) : (
            <div className="space-y-3">
              {answer.clauses.map((clause) => (
                <div key={clause.sectionId}>
                  {clause.published === false && (
                    <p className="mb-1 text-sm font-medium text-rose-800">
                      From an older version that is no longer current.
                    </p>
                  )}
                  <OriginalClause clause={clause} slug={slug} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {answer.status !== 'retired' && (
        <Panel title="Automatic checks">
          {answer.issues.length === 0 ? (
            <p className="text-base text-emerald-900">
              No problems found. The checks cannot tell whether the answer is a fair reading of the
              clauses — that is for the person approving it.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Check results">
              {blocking.map((issue) => (
                <li key={issue.message}>
                  <Notice tone="error">
                    <strong>Must be fixed:</strong> {issue.message}
                  </Notice>
                </li>
              ))}
              {warnings.map((issue) => (
                <li key={issue.message}>
                  <Notice tone="warning">{issue.message}</Notice>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {canApprove && (answer.status === 'draft' || answer.status === 'needs_review') && (
        <ApprovePanel
          ready={answer.readyToApprove}
          busy={busy === 'approve'}
          onApprove={() => void act('approve', 'approve', 'POST', { confirmed: true })}
        />
      )}
      {!canApprove && answer.status !== 'approved' && answer.status !== 'retired' && (
        <Notice>
          An owner or administrator needs to approve this answer before members see it.
        </Notice>
      )}

      <div className="flex flex-wrap gap-3">
        {canApprove && answer.status !== 'retired' && (
          <PortalButton
            variant="secondary"
            busy={busy === 'retire'}
            onClick={() => void act('retire', 'retire', 'POST')}
          >
            Retire (stop showing it)
          </PortalButton>
        )}
        {answer.status === 'retired' && (
          <PortalButton
            variant="secondary"
            busy={busy === 'restore'}
            onClick={() => void act('restore', 'restore', 'POST')}
          >
            Restore as a draft
          </PortalButton>
        )}
        {answer.status !== 'approved' && (
          <PortalButton
            variant="quiet"
            busy={busy === 'delete'}
            onClick={() => {
              if (window.confirm('Delete this answer? This cannot be undone.')) {
                void act('delete', '', 'DELETE');
              }
            }}
          >
            Delete
          </PortalButton>
        )}
      </div>
    </div>
  );
}

function ApprovePanel({
  ready,
  busy,
  onApprove,
}: {
  ready: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Panel title="Approve for members">
      {!ready ? (
        <Notice tone="error">Fix the problems above before this answer can be approved.</Notice>
      ) : (
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-base text-slate-900">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-1 size-5"
            />
            <span>
              I have read this answer against the original clauses. It says nothing the clauses do
              not say, and it is not legal advice.
            </span>
          </label>
          <p className="text-sm text-slate-600">
            Members will see the answer with the original clauses and a note that it is not legal
            advice. Your name is recorded as the approver.
          </p>
          <PortalButton disabled={!confirmed} busy={busy} onClick={onApprove}>
            Approve
          </PortalButton>
        </div>
      )}
    </Panel>
  );
}

function EditForm({
  answer,
  onSaved,
}: {
  answer: ManagedAnswer;
  onSaved: (answer: ManagedAnswer) => void;
}) {
  const { api } = usePortal();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(answer.question);
  const [text, setText] = useState(answer.answer);
  const [clauses, setClauses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestion(answer.question);
    setText(answer.answer);
    setClauses(
      answer.clauses
        .map((clause) => clause.reference ?? '')
        .filter(Boolean)
        .join(', '),
    );
  }, [answer]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await apiFetch<ManagedAnswer>(`${api}/manage/answers/${answer.id}`, {
          method: 'PATCH',
          body: { question, answer: text, clauses: splitClauseReferences(clauses) },
        }),
      );
      setOpen(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <PortalButton variant="secondary" className="mt-4" onClick={() => setOpen(true)}>
        Edit
      </PortalButton>
    );
  }
  return (
    <form onSubmit={save} aria-label="Edit answer" className="mt-4 space-y-4">
      {answer.status === 'approved' && (
        <Notice tone="warning">
          Saving changes hides this answer from members until it is approved again.
        </Notice>
      )}
      <label className="block text-base font-medium text-slate-900">
        Question
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={300}
          required
          className={FIELD}
        />
      </label>
      <label className="block text-base font-medium text-slate-900">
        Answer
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          maxLength={4000}
          required
          className={FIELD}
        />
      </label>
      <label className="block text-base font-medium text-slate-900">
        Clauses it is based on
        <input
          value={clauses}
          onChange={(event) => setClauses(event.target.value)}
          required
          placeholder="For example: 6, 7(a)"
          className={FIELD}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-3">
        <PortalButton type="submit" busy={busy}>
          Save changes
        </PortalButton>
        <PortalButton type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </PortalButton>
      </div>
    </form>
  );
}
