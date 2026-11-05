'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Badge } from '@/components/ui';
import { Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  ANSWER_STATUS,
  answerSourceLabel,
  parseAnswerImport,
  portalPath,
  splitClauseReferences,
  type AnswerImportRow,
  type ManagedAnswer,
  type ManagedAnswerStatus,
} from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

const ORDER: ManagedAnswerStatus[] = ['needs_review', 'draft', 'approved', 'retired'];

const EXAMPLE = `{
  "answers": [
    {
      "question": "How much notice is needed for the annual general meeting?",
      "answer": "Members must get at least 21 days' written notice.",
      "clauses": ["6"],
      "draftedBy": "ai"
    }
  ]
}`;

/** Approved answers: write or import drafts, then check and approve them for members. */
export default function ApprovedAnswersPage() {
  const { api } = usePortal();
  const answers = useApi<ManagedAnswer[]>(`${api}/manage/answers`);

  if (answers.loading && !answers.data) return <PortalLoading />;
  if (answers.error !== undefined && !answers.data) {
    return <Notice tone="error">{describeError(answers.error)}</Notice>;
  }
  const list = answers.data ?? [];

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-base text-slate-600">
        Write answers to common questions in everyday words and link the clauses they come from.
        Every answer starts as a <strong>Draft</strong>. Members only see it once an owner or
        administrator has read it against the original clauses and <strong>approved</strong> it.
        Members always see the original clauses and a note that it is not legal advice.
      </p>

      <NewAnswerForm />
      <ImportPanel onImported={answers.reload} />

      {list.length === 0 && <Notice>No answers have been written yet.</Notice>}
      {ORDER.map((status) => {
        const group = list.filter((answer) => answer.status === status);
        if (group.length === 0) return null;
        return (
          <Panel
            key={status}
            title={`${ANSWER_STATUS[status].label} (${group.length})`}
            description={ANSWER_STATUS[status].help}
          >
            <ul className="divide-y divide-slate-200" aria-label={ANSWER_STATUS[status].label}>
              {group.map((answer) => (
                <AnswerRow key={answer.id} answer={answer} />
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function AnswerRow({ answer }: { answer: ManagedAnswer }) {
  const { slug } = usePortal();
  const blocking = answer.issues.filter((issue) => issue.blocking).length;
  const warnings = answer.issues.length - blocking;
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={portalPath(slug, `/manage/answers/${answer.id}`)}
          className="text-base font-semibold text-[var(--brand-ink)] underline underline-offset-4"
        >
          {answer.question}
        </Link>
        <Badge tone={ANSWER_STATUS[answer.status].tone}>{ANSWER_STATUS[answer.status].label}</Badge>
        {answer.source === 'ai' && <Badge tone="warning">Drafted by AI</Badge>}
        {answer.status !== 'approved' && answer.status !== 'retired' && blocking > 0 && (
          <Badge tone="critical">{blocking === 1 ? '1 problem' : `${blocking} problems`}</Badge>
        )}
        {answer.status !== 'retired' && warnings > 0 && (
          <Badge tone="warning">
            {warnings === 1 ? '1 thing to check' : `${warnings} to check`}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {answerSourceLabel(answer)} · based on{' '}
        {answer.clauses.map((clause) => clause.referenceLabel ?? clause.heading).join(', ') ||
          'no clauses yet'}{' '}
        · last changed {formatDate(answer.updatedAt)}
        {answer.approvedBy ? ` · approved by ${answer.approvedBy}` : ''}
      </p>
    </li>
  );
}

function NewAnswerForm() {
  const { api, slug } = usePortal();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [clauses, setClauses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<ManagedAnswer>(`${api}/manage/answers`, {
        method: 'POST',
        body: { question, answer, clauses: splitClauseReferences(clauses) },
      });
      router.push(portalPath(slug, `/manage/answers/${created.id}`));
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <PortalButton onClick={() => setOpen(true)} className="w-full sm:w-auto">
        Write a new answer
      </PortalButton>
    );
  }
  return (
    <Panel title="Write a new answer">
      <form method="post" onSubmit={submit} aria-label="Write a new answer" className="space-y-4">
        <label className="block text-base font-medium text-slate-900">
          Question, as a member would ask it
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={300}
            required
            placeholder="How much notice is needed for the annual general meeting?"
            className={FIELD}
          />
        </label>
        <label className="block text-base font-medium text-slate-900">
          Answer in everyday words
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={5}
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
          <span className="mt-1 block text-sm font-normal text-slate-600">
            Clause numbers from the current published constitution, separated by commas.
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-3">
          <PortalButton type="submit" busy={busy}>
            Save as draft
          </PortalButton>
          <PortalButton type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </PortalButton>
        </div>
      </form>
    </Panel>
  );
}

function ImportPanel({ onImported }: { onImported: () => Promise<void> }) {
  const { api } = usePortal();
  const [rows, setRows] = useState<AnswerImportRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows(null);
    setError(null);
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > 1_000_000) {
      setError('The file is too large. Import at most 200 answers at a time.');
      return;
    }
    const parsed = parseAnswerImport(await file.text());
    if ('error' in parsed) setError(parsed.error);
    else setRows(parsed.rows);
  }

  async function importRows() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const report = await apiFetch<{ created: { unresolved: string[] }[] }>(
        `${api}/manage/answers/import`,
        { method: 'POST', body: { answers: rows } },
      );
      const unresolved = report.created.filter((row) => row.unresolved.length > 0).length;
      setResult(
        `${report.created.length} ${report.created.length === 1 ? 'draft' : 'drafts'} imported.${
          unresolved > 0
            ? ` ${unresolved} mention clauses that could not be found; they are marked for checking.`
            : ''
        } Nothing has been approved.`,
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
      title="Import drafts from a file"
      description="For answers prepared outside the platform (for example drafted with AI). Every imported answer is a draft until someone approves it."
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
            “{fileName}” has {rows.length} {rows.length === 1 ? 'answer' : 'answers'}
            {rows.some((row) => row.draftedBy === 'ai')
              ? ', some of them marked as drafted by AI'
              : ''}
            .
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
