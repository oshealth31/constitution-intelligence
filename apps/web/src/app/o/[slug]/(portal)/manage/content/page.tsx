'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Badge, StatusBadge } from '@/components/ui';
import { Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  can,
  DOCUMENT_ACCEPT,
  documentProblem,
  extractionLabel,
  portalPath,
  type ContentStatusConstitution,
  type VersionReview,
} from '@/lib/portal';
import { PUBLISH_STEPS_HELP } from '@/lib/publish-guide';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const STATUS_HELP: Record<string, string> = {
  draft: 'Being checked. Members cannot see it.',
  in_review: 'Waiting for an administrator to approve it.',
  approved: 'Approved, but not yet the current version.',
  published: 'The current version that members read.',
  superseded: 'Replaced by a newer version. Kept for the record.',
  archived: 'Withdrawn. Kept for the record only.',
};

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

/** Documents: upload constitutions, see every version and its approval status. */
export default function DocumentsPage() {
  const { api, slug, home } = usePortal();
  const status = useApi<ContentStatusConstitution[]>(`${api}/content-status`);
  const canEdit = can(home.you.permissions, 'content.edit');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function createConstitution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await apiFetch(`${api}/constitutions`, { method: 'POST', body: { title } });
      setTitle('');
      await status.reload();
    } catch (error) {
      setCreateError(describeError(error));
    } finally {
      setCreating(false);
    }
  }

  if (status.loading && !status.data) return <PortalLoading />;
  if (status.error !== undefined && !status.data) {
    return <Notice tone="error">{describeError(status.error)}</Notice>;
  }

  return (
    <div className="space-y-5">
      <Panel title="How to publish a constitution">
        <ol className="space-y-2">
          {PUBLISH_STEPS_HELP.map((step, index) => (
            <li key={step.label} className="flex gap-3 text-base text-slate-800">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary)] text-sm font-bold text-[var(--brand-on-primary)]"
              >
                {index + 1}
              </span>
              <span>
                <strong>{step.label}.</strong> {step.text}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-600">
          Nothing is shown to members until step 5. Each version&apos;s page shows your progress
          and what to do next.
        </p>
      </Panel>

      {status.data?.length === 0 && <Notice>No documents have been added yet.</Notice>}

      {status.data?.map((constitution) => (
        <Panel key={constitution.id} title={constitution.title}>
          {canEdit && (
            <UploadForm
              api={api}
              slug={slug}
              constitutionId={constitution.id}
              title={constitution.title}
            />
          )}
          {constitution.versions.length === 0 && (
            <p className="mt-4 text-base text-slate-600">
              No versions yet. Upload the document to start.
            </p>
          )}
          <ul
            className="mt-4 divide-y divide-slate-200 border-t border-slate-200"
            aria-label={`Versions of ${constitution.title}`}
          >
            {constitution.versions.map((version) => (
              <li key={version.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">
                    Version {version.versionNumber}: {version.label}
                  </p>
                  <StatusBadge status={version.status} />
                  {version.status === 'draft' && (
                    <Badge
                      tone={
                        version.extractionStatus === 'failed'
                          ? 'critical'
                          : version.sectionsNeedingReview > 0
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {version.sectionsNeedingReview > 0
                        ? `${version.sectionsNeedingReview} to check`
                        : extractionLabel(version.extractionStatus)}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {STATUS_HELP[version.status] ?? ''} {version.sectionCount}{' '}
                  {version.sectionCount === 1 ? 'section' : 'sections'}
                  {version.fileName ? ` · from “${version.fileName}”` : ''} · last changed{' '}
                  {formatDate(version.updatedAt)}
                </p>
                {version.latestDecision && (
                  <p className="mt-2 text-sm text-slate-800">
                    Latest review:{' '}
                    <strong>
                      {version.latestDecision.decision === 'approved'
                        ? 'Approved'
                        : 'Changes requested'}
                    </strong>{' '}
                    by {version.latestDecision.reviewerName ?? 'a former member'} on{' '}
                    {formatDate(version.latestDecision.createdAt)}
                    {version.latestDecision.comment ? ` — “${version.latestDecision.comment}”` : ''}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-5">
                  <Link
                    href={portalPath(slug, `/manage/content/${version.id}`)}
                    className="inline-flex min-h-11 items-center text-base font-medium text-[var(--brand-ink)] underline underline-offset-4"
                  >
                    {version.status === 'draft' && canEdit ? 'Check and correct' : 'Review details'}
                  </Link>
                  <Link
                    href={portalPath(slug, `/read/${constitution.id}?version=${version.id}`)}
                    className="inline-flex min-h-11 items-center text-base font-medium text-[var(--brand-ink)] underline underline-offset-4"
                  >
                    Open this version
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      {canEdit && (
        <Panel
          title="Add another document"
          description="For example a code of conduct or by-laws. You can upload its file next."
        >
          <form
            method="post"
            onSubmit={createConstitution}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            aria-label="Add another document"
          >
            <label className="block flex-1 text-base font-medium text-slate-900">
              Document title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                minLength={3}
                maxLength={300}
                className={FIELD}
              />
            </label>
            <PortalButton type="submit" busy={creating} variant="secondary">
              Add document
            </PortalButton>
          </form>
          {createError && (
            <div className="mt-3">
              <Notice tone="error">{createError}</Notice>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function UploadForm({
  api,
  slug,
  constitutionId,
  title,
}: {
  api: string;
  slug: string;
  constitutionId: string;
  title: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      setError('Please choose the document first.');
      return;
    }
    const problem = documentProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const query = label.trim() ? `?label=${encodeURIComponent(label.trim())}` : '';
      const version = await apiFetch<VersionReview>(
        `${api}/constitutions/${constitutionId}/versions${query}`,
        { method: 'POST', file },
      );
      router.push(portalPath(slug, `/manage/content/${version.id}`));
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={upload}
      aria-label={`Upload a new version of ${title}`}
      className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
    >
      <p className="text-base font-semibold text-slate-900">Upload a new version</p>
      <p className="mt-1 text-sm text-slate-600">
        PDF or Word (.docx), up to 10 MB. The text is read automatically and kept as a draft for you
        to check. Nothing is published until an administrator approves it.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-base font-medium text-slate-900">
          Document file
          <input
            ref={input}
            type="file"
            accept={DOCUMENT_ACCEPT}
            onChange={() => setError(null)}
            className="mt-2 block w-full text-base file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-[var(--brand-primary)] file:px-4 file:font-semibold file:text-[var(--brand-on-primary)]"
          />
        </label>
        <label className="block text-base font-medium text-slate-900">
          Name for this version (optional)
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={200}
            placeholder="e.g. Amended at the 2026 AGM"
            className={FIELD}
          />
        </label>
        <PortalButton type="submit" busy={busy}>
          {busy ? 'Reading the document…' : 'Upload'}
        </PortalButton>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </form>
  );
}
