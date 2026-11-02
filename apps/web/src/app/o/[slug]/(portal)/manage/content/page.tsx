'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/ui';
import { Notice, Panel, PortalLoading } from '@/components/portal-ui';
import { describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { portalPath, type ContentStatusConstitution } from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const STATUS_HELP: Record<string, string> = {
  draft: 'Being prepared. Members cannot see it.',
  in_review: 'Waiting for a content reviewer to check it.',
  approved: 'Checked and approved, but not yet published to members.',
  published: 'This is the version members read.',
  superseded: 'Replaced by a newer published version.',
  archived: 'Kept for the record only.',
};

/** Approval status of every version of every document. */
export default function ContentStatusPage() {
  const { api, slug } = usePortal();
  const status = useApi<ContentStatusConstitution[]>(`${api}/content-status`);

  if (status.loading && !status.data) return <PortalLoading />;
  if (status.error !== undefined) return <Notice tone="error">{describeError(status.error)}</Notice>;
  if (!status.data || status.data.length === 0) {
    return <Notice>No documents have been added yet.</Notice>;
  }

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-base text-slate-600">
        Every document goes through these steps: <strong>Draft</strong> →{' '}
        <strong>In review</strong> → <strong>Approved</strong> → <strong>Published</strong>. Only
        published versions are shown to members.
      </p>
      {status.data.map((constitution) => (
        <Panel key={constitution.id} title={constitution.title}>
          <ul className="divide-y divide-slate-200" aria-label={`Versions of ${constitution.title}`}>
            {constitution.versions.map((version) => (
              <li key={version.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">
                    Version {version.versionNumber}: {version.label}
                  </p>
                  <StatusBadge status={version.status} />
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {STATUS_HELP[version.status] ?? ''} {version.sectionCount} sections · last
                  changed {formatDate(version.updatedAt)}
                  {version.publishedAt ? ` · published ${formatDate(version.publishedAt)}` : ''}
                </p>
                {version.latestDecision ? (
                  <p className="mt-2 text-sm text-slate-800">
                    Latest review:{' '}
                    <strong>
                      {version.latestDecision.decision === 'approved' ? 'Approved' : 'Changes requested'}
                    </strong>{' '}
                    by {version.latestDecision.reviewerName ?? 'a former member'} on{' '}
                    {formatDate(version.latestDecision.createdAt)}
                    {version.latestDecision.comment ? ` — “${version.latestDecision.comment}”` : ''}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Not reviewed yet.</p>
                )}
                <Link
                  href={portalPath(slug, `/read/${constitution.id}?version=${version.id}`)}
                  className="mt-2 inline-flex min-h-11 items-center text-base font-medium text-[var(--brand-ink)] underline underline-offset-4"
                >
                  Open this version
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
