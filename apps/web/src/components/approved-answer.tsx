'use client';

import Link from 'next/link';
import { formatDate } from '@/lib/format';
import {
  portalPath,
  sectionAnchor,
  sectionTitle,
  type LinkedClause,
  type MemberAnswer,
} from '@/lib/portal';

/** Title for a linked clause: "Clause 7(a)" for an untitled sub-clause, otherwise its heading. */
export function clauseTitle(clause: LinkedClause): string {
  return clause.kind === 'subclause' && !clause.heading && clause.referenceLabel
    ? clause.referenceLabel
    : sectionTitle(clause);
}

/** The original wording of a clause, exactly as stored, with where it comes from. */
export function OriginalClause({ clause, slug }: { clause: LinkedClause; slug?: string }) {
  const title = clauseTitle(clause);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-500">
        {clause.constitutionTitle} · Version {clause.versionNumber}: {clause.versionLabel}
        {clause.publishedAt ? ` (published ${formatDate(clause.publishedAt)})` : ''}
      </p>
      {clause.location && <p className="mt-1 text-sm text-slate-600">{clause.location}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[var(--brand-ink)]">{title}</span>
        {clause.referenceLabel && clause.referenceLabel !== title && (
          <span className="rounded-full bg-[var(--brand-secondary)] px-2.5 py-0.5 text-sm font-medium text-[var(--brand-on-secondary)]">
            {clause.referenceLabel}
          </span>
        )}
      </p>
      <blockquote className="mt-2 border-l-4 border-[var(--brand-accent)] pl-3 text-base whitespace-pre-line text-slate-800">
        <span className="sr-only">Original text: </span>
        {clause.text || <em className="text-slate-500">(This heading has no text of its own.)</em>}
      </blockquote>
      {slug && (
        <Link
          href={portalPath(
            slug,
            `/read/${clause.constitutionId}?version=${clause.versionId}#${sectionAnchor(clause.refKey)}`,
          )}
          className="mt-2 inline-flex min-h-11 items-center font-medium text-[var(--brand-ink)] underline underline-offset-4"
        >
          Open this clause in the constitution
        </Link>
      )}
    </div>
  );
}

/**
 * An answer approved by the organisation, as members see it: the everyday-words answer, the
 * disclaimer, and the original clauses it is based on.
 */
export function ApprovedAnswerCard({
  answer,
  organisationName,
  disclaimer,
  slug,
  headingLevel = 'h3',
}: {
  answer: MemberAnswer;
  organisationName: string;
  disclaimer: string;
  slug: string;
  headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  return (
    <article
      aria-label={`Approved answer: ${answer.question}`}
      className="rounded-2xl border-2 border-[var(--brand-accent)] bg-white p-5"
    >
      <p className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-emerald-900 uppercase ring-1 ring-emerald-200 ring-inset">
        Approved by {organisationName}
      </p>
      <Heading className="mt-2 text-lg font-semibold text-slate-900">{answer.question}</Heading>
      <p data-testid="approved-answer-text" className="mt-2 text-lg whitespace-pre-line text-slate-900">
        {answer.answer}
      </p>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset">
        <strong>Not legal advice.</strong> {disclaimer}
      </p>
      <p className="mt-4 text-base font-semibold text-slate-900">
        Based on {answer.clauses.length === 1 ? 'this clause' : 'these clauses'} of the constitution
      </p>
      <div className="mt-2 space-y-3">
        {answer.clauses.map((clause) => (
          <OriginalClause key={clause.sectionId} clause={clause} slug={slug} />
        ))}
      </div>
      {answer.approvedAt && (
        <p className="mt-3 text-sm text-slate-500">Approved on {formatDate(answer.approvedAt)}</p>
      )}
    </article>
  );
}
