'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Badge, StatusBadge } from '@/components/ui';
import { BackLink, Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import {
  can,
  eventLabel,
  extractionLabel,
  portalPath,
  sectionTitle,
  workflowStep,
  type ReviewSection,
  type VersionReview,
} from '@/lib/portal';
import { publishGuide } from '@/lib/publish-guide';
import { useApi } from '@/lib/use-api';
import { BackToTop, PublishGuidePanel, scrollToElement } from '@/components/publish-guide';
import { usePortal } from '../../../portal-context';

const FIELD =
  'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';
const KINDS = [
  { value: 'part', label: 'Part' },
  { value: 'chapter', label: 'Chapter' },
  { value: 'section', label: 'Heading' },
  { value: 'clause', label: 'Clause' },
  { value: 'subclause', label: 'Sub-clause' },
];

type Message = { tone: 'success' | 'error'; text: string } | null;

/**
 * Checking one version: the original document, what could not be read with certainty, the
 * extracted sections (editable while a draft), the approval steps and the version history.
 */
export default function VersionReviewPage() {
  const { api, slug, home } = usePortal();
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const review = useApi<VersionReview>(`${api}/versions/${versionId}/review`);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const canEdit = can(home.you.permissions, 'content.edit');
  const canApprove = can(home.you.permissions, 'content.approve');

  async function act(
    key: string,
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    success: string,
  ) {
    setBusy(key);
    setMessage(null);
    try {
      const updated = await apiFetch<VersionReview>(`${api}/versions/${versionId}${path}`, {
        method,
        body,
      });
      review.setData(updated);
      setMessage({ tone: 'success', text: success });
      return true;
    } catch (error) {
      setMessage({ tone: 'error', text: describeError(error) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (review.loading && !review.data) return <PortalLoading />;
  if (!review.data) {
    return (
      <div>
        <BackLink href={portalPath(slug, '/manage/content')}>Back to Documents</BackLink>
        <Notice tone="error">{describeError(review.error)}</Notice>
      </div>
    );
  }
  const version = review.data;
  const editable = version.editable && canEdit;
  const step = workflowStep(version.status);
  const guide = publishGuide(version, { canEdit, canApprove });
  const visible = onlyFlagged
    ? version.sections.filter((section) => section.needsReview)
    : version.sections;

  return (
    <div className="space-y-5">
      <BackLink href={portalPath(slug, '/manage/content')}>Back to Documents</BackLink>
      <header>
        <p className="text-sm font-medium text-slate-600">{version.constitution?.title}</p>
        <h2
          id="version-title"
          tabIndex={-1}
          className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-slate-900 sm:text-2xl"
        >
          Version {version.versionNumber}: {version.label} <StatusBadge status={version.status} />
        </h2>
      </header>

      {guide && (
        <PublishGuidePanel
          guide={guide}
          onGo={() => {
            if (guide.target === 'documents') {
              router.push(portalPath(slug, '/manage/content'));
            } else if (guide.target === 'next-section') {
              const next = version.sections.find((section) => section.needsReview);
              if (next) scrollToElement(`section-${next.id}`);
            } else if (guide.target === 'approval') {
              scrollToElement('approval');
            }
          }}
        />
      )}
      {step < 0 && (
        <Notice>
          This version is <strong>{version.status}</strong>. It is kept unchanged for the record.
        </Notice>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <ExtractionPanel version={version} />

          <Panel
            title={`Extracted text (${version.sections.length} sections)`}
            description={
              editable
                ? 'Compare each section with the original document. Correct anything that is wrong. Sections marked “Check this” must be confirmed before the version can be sent for approval.'
                : 'This version can no longer be edited. To change the wording, upload a new version.'
            }
          >
            {version.sectionsNeedingReview > 0 && (
              <label className="mb-4 flex items-center gap-3 text-base text-slate-800">
                <input
                  type="checkbox"
                  checked={onlyFlagged}
                  onChange={(event) => setOnlyFlagged(event.target.checked)}
                  className="size-5"
                />
                Show only the {version.sectionsNeedingReview} section
                {version.sectionsNeedingReview === 1 ? '' : 's'} to check
              </label>
            )}
            {version.sections.length === 0 && (
              <p className="text-base text-slate-600">No sections were found in this document.</p>
            )}
            <ol className="space-y-3">
              {visible.map((section) => (
                <SectionItem
                  key={section.id}
                  section={section}
                  editable={editable}
                  busy={busy}
                  onSave={(change) =>
                    act(
                      `edit-${section.id}`,
                      `/sections/${section.id}`,
                      'PATCH',
                      change,
                      'Section saved.',
                    )
                  }
                  onResolve={() =>
                    act(
                      `resolve-${section.id}`,
                      `/sections/${section.id}/resolve`,
                      'POST',
                      undefined,
                      'Marked as checked.',
                    )
                  }
                  onRemove={() =>
                    act(
                      `remove-${section.id}`,
                      `/sections/${section.id}`,
                      'DELETE',
                      undefined,
                      'Section removed.',
                    )
                  }
                  onAddAfter={(input) =>
                    act(
                      `add-${section.id}`,
                      '/sections',
                      'POST',
                      { afterSectionId: section.id, ...input },
                      'Section added.',
                    )
                  }
                />
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
          <OriginalPanel version={version} api={api} />
          <WorkflowPanel
            key={version.status}
            version={version}
            canEdit={canEdit}
            canApprove={canApprove}
            busy={busy}
            act={act}
          />
          <Panel title="History">
            <ol className="space-y-3">
              <li className="text-sm text-slate-700">
                <strong>Uploaded</strong> {formatDateTime(version.createdAt)}
                {version.source?.uploadedBy ? ` by ${version.source.uploadedBy}` : ''}
              </li>
              {version.history.map((event) => (
                <li key={event.id} className="text-sm text-slate-700">
                  <strong>{eventLabel(event.event)}</strong> {formatDateTime(event.at)}
                  {event.by ? ` by ${event.by}` : ''}
                  {event.comment ? (
                    <span className="block text-slate-600">“{event.comment}”</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
      <BackToTop focusId="version-title" />
    </div>
  );
}

function ExtractionPanel({ version }: { version: VersionReview }) {
  const { status, issues, meta } = version.extraction;
  const tone = status === 'failed' ? 'error' : status === 'needs_review' ? 'warning' : 'success';
  return (
    <Panel title="Reading the document">
      <Notice tone={tone}>
        <strong>{extractionLabel(status)}.</strong>{' '}
        {status === 'failed'
          ? 'The text could not be read, so this version cannot be approved. The original is kept safely.'
          : status === 'needs_review'
            ? 'Some parts were not certain. They are marked “Check this” below.'
            : 'The structure was recognised without problems. Please still compare it with the original.'}
      </Notice>
      {issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className="flex gap-2 text-base text-slate-800">
              <Badge tone={issue.severity === 'error' ? 'critical' : 'warning'}>
                {issue.severity === 'error' ? 'Problem' : 'Check'}
              </Badge>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-slate-600">
        {meta.format === 'pdf' ? 'PDF' : meta.format === 'docx' ? 'Word document' : 'Document'}
        {meta.pageCount ? ` · ${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'}` : ''}
        {typeof meta.characterCount === 'number'
          ? ` · ${meta.characterCount.toLocaleString()} characters read`
          : ''}
        {meta.detectedTitle ? ` · title found: “${meta.detectedTitle}”` : ''}
      </p>
    </Panel>
  );
}

function OriginalPanel({ version, api }: { version: VersionReview; api: string }) {
  if (!version.source) {
    return (
      <Panel title="Original document">
        <p className="text-base text-slate-600">
          This version was not created from an uploaded file.
        </p>
      </Panel>
    );
  }
  const source = version.source;
  return (
    <Panel
      title="Original document"
      description="The uploaded file is the authoritative source. It is never changed."
    >
      <dl className="space-y-1 text-sm text-slate-700">
        <div>
          <dt className="inline font-medium">File: </dt>
          <dd className="inline break-all">{source.fileName}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Size: </dt>
          <dd className="inline">{formatBytes(source.sizeBytes)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Uploaded: </dt>
          <dd className="inline">
            {formatDate(source.uploadedAt)}
            {source.uploadedBy ? ` by ${source.uploadedBy}` : ''}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Fingerprint: </dt>
          <dd className="inline font-mono text-xs" title={source.sha256}>
            {source.sha256.slice(0, 16)}…
          </dd>
        </div>
      </dl>
      {source.contentRemoved || source.quarantined ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200 ring-inset"
        >
          {source.contentRemoved
            ? 'Constitution Intelligence staff removed this file after a safety check. The text already read from it is still available. Contact support if you need to upload a clean copy.'
            : 'Constitution Intelligence staff are holding this file for a safety check, so it cannot be downloaded at the moment. The text already read from it is still available.'}
        </p>
      ) : (
        <a
          href={`/api/v1${api}/versions/${version.id}/source`}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white px-5 text-base font-semibold text-[var(--brand-ink)] ring-1 ring-slate-300 ring-inset hover:bg-slate-50"
        >
          Download the original
        </a>
      )}
    </Panel>
  );
}

function WorkflowPanel({
  version,
  canEdit,
  canApprove,
  busy,
  act,
}: {
  version: VersionReview;
  canEdit: boolean;
  canApprove: boolean;
  busy: string | null;
  act: (
    key: string,
    path: string,
    method: 'POST',
    body: unknown,
    success: string,
  ) => Promise<boolean>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  let content: ReactNode = null;
  if (version.status === 'draft') {
    const blocked =
      version.extraction.status === 'failed'
        ? 'The text could not be read. Upload a readable copy instead.'
        : version.sectionsNeedingReview > 0
          ? `${version.sectionsNeedingReview} section${version.sectionsNeedingReview === 1 ? ' still needs' : 's still need'} checking first.`
          : null;
    content = canEdit ? (
      <form
        method="post"
        aria-label="Send for approval"
        className="space-y-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void act(
            'submit',
            '/submit',
            'POST',
            { confirmed: true, comment: comment || undefined },
            'Sent for approval.',
          );
        }}
      >
        <p className="text-base text-slate-700">
          When the text matches the original, send it to an administrator for approval.
        </p>
        {blocked && <Notice tone="warning">{blocked}</Notice>}
        <label className="flex items-start gap-3 text-base text-slate-800">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-5"
          />
          I have compared this text with the original document.
        </label>
        <label className="block text-sm font-medium text-slate-900">
          Note for the approver (optional)
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            maxLength={2000}
            className={FIELD}
          />
        </label>
        <PortalButton
          type="submit"
          className="w-full"
          busy={busy === 'submit'}
          disabled={!confirmed || blocked !== null}
        >
          Send for approval
        </PortalButton>
      </form>
    ) : (
      <p className="text-base text-slate-700">This draft is being checked.</p>
    );
  } else if (version.status === 'in_review') {
    content = canApprove ? (
      <div className="space-y-4">
        <form
          method="post"
          aria-label="Approve"
          className="space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void act(
              'approve',
              '/approve',
              'POST',
              { comment: comment || undefined },
              'Approved. You can now make it the current version.',
            );
          }}
        >
          <label className="block text-sm font-medium text-slate-900">
            Comment (optional)
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={2}
              maxLength={2000}
              className={FIELD}
            />
          </label>
          <PortalButton type="submit" className="w-full" busy={busy === 'approve'}>
            Approve
          </PortalButton>
        </form>
        <form
          method="post"
          aria-label="Send back for changes"
          className="space-y-3 border-t border-slate-200 pt-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void act(
              'changes',
              '/request-changes',
              'POST',
              { comment: reason },
              'Sent back for changes.',
            );
          }}
        >
          <label className="block text-sm font-medium text-slate-900">
            What needs to change?
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              required
              minLength={5}
              maxLength={2000}
              className={FIELD}
            />
          </label>
          <PortalButton
            type="submit"
            variant="secondary"
            className="w-full"
            busy={busy === 'changes'}
          >
            Send back for changes
          </PortalButton>
        </form>
      </div>
    ) : (
      <p className="text-base text-slate-700">
        Waiting for an organisation administrator to approve it.
      </p>
    );
  } else if (version.status === 'approved') {
    content = canApprove ? (
      <form
        method="post"
        aria-label="Make this the current version"
        className="space-y-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void act(
            'publish',
            '/publish',
            'POST',
            { confirmed: true },
            'This is now the current version that members read.',
          );
        }}
      >
        <p className="text-base text-slate-700">
          Approved. Making it current shows it to all members. The version they read now will be
          kept as “superseded”.
        </p>
        <label className="flex items-start gap-3 text-base text-slate-800">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-5"
          />
          Yes, make this the current constitution.
        </label>
        <PortalButton
          type="submit"
          className="w-full"
          busy={busy === 'publish'}
          disabled={!confirmed}
        >
          Make current
        </PortalButton>
      </form>
    ) : (
      <p className="text-base text-slate-700">
        Approved. An administrator can make it the current version.
      </p>
    );
  } else if (version.status === 'published') {
    content = (
      <p className="text-base text-slate-700">This is the current version that members read.</p>
    );
  }

  const canArchive = canApprove && !['published', 'archived'].includes(version.status);
  return (
    <Panel title="Approval" id="approval">
      {content}
      {canArchive && (
        <details className="mt-4 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-base font-medium text-slate-800">
            Archive this version
          </summary>
          <form
            method="post"
            aria-label="Archive this version"
            className="mt-3 space-y-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void act(
                'archive',
                '/archive',
                'POST',
                { comment: archiveReason },
                'Version archived.',
              );
            }}
          >
            <label className="block text-sm font-medium text-slate-900">
              Reason
              <textarea
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
                rows={2}
                required
                minLength={5}
                maxLength={2000}
                className={FIELD}
              />
            </label>
            <PortalButton
              type="submit"
              variant="secondary"
              className="w-full"
              busy={busy === 'archive'}
            >
              Archive
            </PortalButton>
          </form>
        </details>
      )}
    </Panel>
  );
}

function SectionItem({
  section,
  editable,
  busy,
  onSave,
  onResolve,
  onRemove,
  onAddAfter,
}: {
  section: ReviewSection;
  editable: boolean;
  busy: string | null;
  onSave: (change: {
    kind: string;
    number: string;
    heading: string;
    body: string;
  }) => Promise<boolean>;
  onResolve: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onAddAfter: (input: {
    kind: string;
    number: string;
    heading: string;
    body: string;
  }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'add' | 'remove'>('view');
  const indent =
    section.kind === 'subclause' ? 'sm:ml-8' : section.kind === 'clause' ? 'sm:ml-4' : '';
  const title = sectionTitle(section);

  return (
    <li
      id={`section-${section.id}`}
      tabIndex={-1}
      className={`rounded-xl border p-4 ${indent} ${
        section.needsReview ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
      aria-label={`Section ${title}`}
    >
      {section.needsReview && (
        <p className="mb-2 text-sm font-semibold text-amber-900">
          ⚠ Check this: <span className="font-normal">{section.reviewReason}</span>
        </p>
      )}
      {mode === 'edit' ? (
        <SectionForm
          initial={section}
          submitLabel="Save section"
          busy={busy === `edit-${section.id}`}
          onCancel={() => setMode('view')}
          onSubmit={async (value) => {
            if (await onSave(value)) setMode('view');
          }}
        />
      ) : (
        <>
          <p
            className={
              section.kind === 'part' || section.kind === 'chapter' || section.kind === 'section'
                ? 'text-lg font-bold text-slate-900'
                : 'font-semibold text-slate-900'
            }
          >
            {title}
          </p>
          {section.body && (
            <p className="mt-1 text-base whitespace-pre-line text-slate-800">{section.body}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            {KINDS.find((kind) => kind.value === section.kind)?.label}
            {section.sourcePage ? ` · page ${section.sourcePage}` : ''}
            {section.editedAt ? ' · corrected' : ''}
            {section.reviewedAt ? ' · checked' : ''}
          </p>
        </>
      )}
      {editable && mode === 'view' && (
        // Phones: a tidy two-column grid of equal buttons. Wider screens: one row.
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {section.needsReview && (
            <PortalButton
              className="col-span-2 min-h-11 px-3 py-2 text-sm"
              busy={busy === `resolve-${section.id}`}
              onClick={() => void onResolve()}
            >
              Mark as checked
            </PortalButton>
          )}
          <PortalButton
            variant="secondary"
            className="min-h-11 px-3 py-2 text-sm"
            onClick={() => setMode('edit')}
          >
            Edit
          </PortalButton>
          <PortalButton
            variant="secondary"
            className="min-h-11 px-3 py-2 text-sm"
            onClick={() => setMode('add')}
          >
            Add after
          </PortalButton>
          <PortalButton
            variant="secondary"
            className="col-span-2 min-h-11 px-3 py-2 text-sm sm:col-span-1"
            onClick={() => setMode('remove')}
          >
            Remove
          </PortalButton>
        </div>
      )}
      {editable && mode === 'remove' && (
        <div className="mt-3 rounded-lg bg-rose-50 p-3">
          <p className="text-sm text-rose-900">
            Remove this section and anything inside it from the draft?
          </p>
          <div className="mt-2 flex gap-2">
            <PortalButton
              className="min-h-10 bg-rose-700 py-2 text-sm text-white"
              busy={busy === `remove-${section.id}`}
              onClick={() => void onRemove()}
            >
              Yes, remove
            </PortalButton>
            <PortalButton
              variant="secondary"
              className="min-h-10 py-2 text-sm"
              onClick={() => setMode('view')}
            >
              Cancel
            </PortalButton>
          </div>
        </div>
      )}
      {editable && mode === 'add' && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="mb-2 text-sm font-semibold text-slate-900">New section after this one</p>
          <SectionForm
            initial={{
              kind: section.kind === 'part' ? 'clause' : section.kind,
              number: '',
              heading: '',
              body: '',
            }}
            submitLabel="Add section"
            busy={busy === `add-${section.id}`}
            onCancel={() => setMode('view')}
            onSubmit={async (value) => {
              if (await onAddAfter(value)) setMode('view');
            }}
          />
        </div>
      )}
    </li>
  );
}

function SectionForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: { kind: string; number: string | null; heading: string | null; body: string };
  submitLabel: string;
  busy: boolean;
  onSubmit: (value: {
    kind: string;
    number: string;
    heading: string;
    body: string;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [number, setNumber] = useState(initial.number ?? '');
  const [heading, setHeading] = useState(initial.heading ?? '');
  const [body, setBody] = useState(initial.body);
  return (
    <form
      method="post"
      className="space-y-3"
      aria-label={submitLabel}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void onSubmit({ kind, number, heading, body });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_8rem_1fr]">
        <label className="block text-sm font-medium text-slate-900">
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value)} className={FIELD}>
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-900">
          Number
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            maxLength={40}
            className={FIELD}
          />
        </label>
        <label className="block text-sm font-medium text-slate-900">
          Heading
          <input
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
            maxLength={500}
            className={FIELD}
          />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-900">
        Text
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={50000}
          className={FIELD}
        />
      </label>
      <div className="flex gap-2">
        <PortalButton type="submit" className="min-h-10 py-2 text-sm" busy={busy}>
          {submitLabel}
        </PortalButton>
        <PortalButton
          type="button"
          variant="secondary"
          className="min-h-10 py-2 text-sm"
          onClick={onCancel}
        >
          Cancel
        </PortalButton>
      </div>
    </form>
  );
}
