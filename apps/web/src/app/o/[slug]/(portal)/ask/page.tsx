'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  ChatIcon,
  Notice,
  Panel,
  PortalButton,
  PortalHeading,
  PortalLoading,
} from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  locateQuote,
  portalPath,
  sectionAnchor,
  sectionTitle,
  type AiStatus,
  type AnswerCitation,
  type AnswerResponse,
} from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../portal-context';

/**
 * Ask a question about the constitution. The AI explanation is always shown separately from
 * the original text it relies on, with links to each source section.
 */
export default function AskPage() {
  const { api, slug } = usePortal();
  const status = useApi<AiStatus>(`${api}/ai/status`);
  const suggestions = useApi<string[]>(`${api}/ai/suggested-questions`);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;
    setQuestion(trimmed);
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await apiFetch<AnswerResponse>(`${api}/ai/ask`, { method: 'POST', body: { question: trimmed } }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PortalHeading
        icon={<ChatIcon className="size-6" />}
        title="Ask a question"
        description="Ask in your own words. The answer is based only on your organisation’s approved constitution, and shows the original text it comes from."
      />

      {status.data && (
        <Notice tone="info">
          <strong>Please note:</strong> {status.data.disclaimer}
        </Notice>
      )}
      {status.data && !status.data.available && (
        <Notice tone="warning">
          Questions are not available right now. You can still{' '}
          <Link href={portalPath(slug, '/search')} className="font-medium underline underline-offset-4">
            search the constitution
          </Link>
          .
        </Notice>
      )}
      {status.data?.mode === 'offline' && (
        <Notice tone="warning">
          Test mode: no AI model is connected, so answers only point to the best-matching passage.
        </Notice>
      )}

      <form onSubmit={onSubmit} aria-label="Ask a question" className="space-y-3">
        <label htmlFor="question" className="block text-base font-medium text-slate-900">
          Your question
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="For example: How many members must be present at a general meeting?"
          className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none"
        />
        <PortalButton type="submit" busy={busy} disabled={question.trim().length < 3 || status.data?.available === false}>
          <ChatIcon className="size-5" />
          {busy ? 'Looking in the constitution…' : 'Ask'}
        </PortalButton>
      </form>

      {!answer && !busy && (suggestions.data?.length ?? 0) > 0 && (
        <div>
          <p className="text-base text-slate-600">You could ask:</p>
          <ul className="mt-2 flex flex-col gap-2">
            {suggestions.data!.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-left text-base text-slate-800 hover:border-[var(--brand-accent)]"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div aria-live="polite">
        {busy && <PortalLoading label="Looking in the constitution…" />}
        {error && <Notice tone="error">{error}</Notice>}
        {answer && <AnswerView answer={answer} slug={slug} api={api} />}
      </div>
    </div>
  );
}

function AnswerView({ answer, slug, api }: { answer: AnswerResponse; slug: string; api: string }) {
  if (answer.status !== 'answered') {
    return (
      <Panel title="Answer">
        <p data-testid="answer-message" className="text-lg text-slate-900">
          {answer.message}
        </p>
        {answer.status === 'insufficient' && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-base text-slate-700">
            <li>Try asking in a different way, or about one topic at a time.</li>
            <li>
              <Link href={portalPath(slug, '/search')} className="font-medium text-[var(--brand-ink)] underline underline-offset-4">
                Search the constitution
              </Link>{' '}
              for a word or clause number.
            </li>
            <li>If the constitution does not cover it, ask your organisation’s committee.</li>
          </ul>
        )}
        <Feedback api={api} messageId={answer.messageId} />
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      <Panel title="Explanation">
        <p className="mb-2 inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-amber-900 uppercase ring-1 ring-amber-200 ring-inset">
          Written by AI · check the original text below
        </p>
        <p data-testid="answer-explanation" className="text-lg whitespace-pre-line text-slate-900">
          {answer.explanation}
        </p>
        <p className="mt-3 text-sm text-slate-600">{answer.disclaimer}</p>
      </Panel>
      <section aria-labelledby="sources-heading" className="space-y-3">
        <h2 id="sources-heading" className="text-lg font-semibold text-slate-900">
          Original text from the approved constitution
        </h2>
        <ol className="space-y-3">
          {answer.citations.map((citation) => (
            <SourceCard key={`${citation.sectionId}-${citation.quote}`} citation={citation} slug={slug} />
          ))}
        </ol>
      </section>
      <Feedback api={api} messageId={answer.messageId} />
    </div>
  );
}

function SourceCard({ citation, slug }: { citation: AnswerCitation; slug: string }) {
  const title =
    citation.kind === 'subclause' && !citation.heading && citation.referenceLabel
      ? citation.referenceLabel
      : sectionTitle(citation);
  const parts = locateQuote(citation.sourceText, citation.quote);
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-5" aria-label={`Source: ${citation.referenceLabel ?? title}`}>
      <p className="text-sm text-slate-500">
        {citation.constitutionTitle} · Version {citation.versionNumber}: {citation.versionLabel}
        {citation.publishedAt ? ` (published ${formatDate(citation.publishedAt)})` : ''}
      </p>
      {citation.location && <p className="mt-1 text-sm text-slate-600">{citation.location}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-[var(--brand-ink)]">{title}</span>
        {citation.referenceLabel && citation.referenceLabel !== title && (
          <span className="rounded-full bg-[var(--brand-secondary)] px-2.5 py-0.5 text-sm font-medium text-[var(--brand-on-secondary)]">
            {citation.referenceLabel}
          </span>
        )}
      </p>
      <blockquote className="mt-2 border-l-4 border-[var(--brand-accent)] pl-3 text-base whitespace-pre-line text-slate-800">
        <span className="sr-only">Original text: </span>
        {parts ? (
          <>
            {parts.before}
            <mark className="rounded bg-[var(--brand-accent)] px-0.5 text-[var(--brand-on-accent)]">{parts.quote}</mark>
            {parts.after}
          </>
        ) : (
          citation.sourceText || citation.quote
        )}
      </blockquote>
      {citation.sourcePage && (
        <p className="mt-1 text-sm text-slate-500">Page {citation.sourcePage} of the original document</p>
      )}
      <Link
        href={portalPath(slug, `/read/${citation.constitutionId}?version=${citation.versionId}#${sectionAnchor(citation.refKey)}`)}
        className="mt-2 inline-flex min-h-11 items-center font-medium text-[var(--brand-ink)] underline underline-offset-4"
      >
        Open this section in the constitution
      </Link>
    </li>
  );
}

function Feedback({ api, messageId }: { api: string; messageId: string }) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(value: boolean, withComment = false) {
    setHelpful(value);
    setError(null);
    try {
      await apiFetch(`${api}/ai/messages/${messageId}/feedback`, {
        method: 'POST',
        body: { helpful: value, comment: withComment ? comment : undefined },
      });
      setSent(withComment || value);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Feedback">
      {sent ? (
        <p className="text-base text-slate-800">Thank you for your feedback.</p>
      ) : (
        <>
          <p className="text-base font-medium text-slate-900">Was this helpful?</p>
          <div className="mt-2 flex gap-2">
            <PortalButton variant={helpful === true ? 'primary' : 'secondary'} className="min-h-11 py-2" onClick={() => void send(true)}>
              Yes
            </PortalButton>
            <PortalButton variant={helpful === false ? 'primary' : 'secondary'} className="min-h-11 py-2" onClick={() => void send(false)}>
              No
            </PortalButton>
          </div>
          {helpful === false && (
            <form
              className="mt-3 space-y-2"
              aria-label="What was wrong?"
              onSubmit={(event) => {
                event.preventDefault();
                void send(false, true);
              }}
            >
              <label className="block text-sm font-medium text-slate-900">
                What was wrong or missing? (optional)
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={2}
                  maxLength={1000}
                  className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base"
                />
              </label>
              <PortalButton type="submit" variant="secondary" className="min-h-11 py-2">
                Send
              </PortalButton>
            </form>
          )}
        </>
      )}
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
