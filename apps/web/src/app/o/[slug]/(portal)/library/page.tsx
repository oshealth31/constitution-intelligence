'use client';

import { BookIcon, Notice, PortalLink, PortalHeading, PortalLoading } from '@/components/portal-ui';
import { describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { can, portalPath, type LibraryItem } from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../portal-context';

/** The organisation's constitution library. */
export default function LibraryPage() {
  const { api, slug, home } = usePortal();
  const library = useApi<LibraryItem[]>(`${api}/library`);
  const isReviewer = can(home.you.permissions, 'content.review');

  return (
    <div>
      <PortalHeading
        icon={<BookIcon className="size-6" />}
        title="Read"
        description="Choose a document to read. Everything here has been approved and published by your organisation."
      />
      {library.loading && <PortalLoading />}
      {library.error !== undefined && <Notice tone="error">{describeError(library.error)}</Notice>}
      {library.data && library.data.length === 0 && (
        <Notice>No documents have been published yet. Please check again later.</Notice>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {library.data?.map((item) => (
          <li
            key={item.id}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:p-6"
          >
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            {item.published ? (
              <p className="mt-1 text-base text-slate-600">
                {item.published.label}
                {item.published.publishedAt
                  ? ` · published ${formatDate(item.published.publishedAt)}`
                  : ''}
                {` · ${item.published.sectionCount} sections`}
              </p>
            ) : (
              <p className="mt-1 text-base text-slate-600">Not published yet.</p>
            )}
            {isReviewer && (item.versionsInProgress ?? 0) > 0 && (
              <p className="mt-2 text-sm font-medium text-amber-800">
                {item.versionsInProgress} version{item.versionsInProgress === 1 ? '' : 's'} being
                prepared or reviewed
              </p>
            )}
            <div className="mt-4 flex-1" />
            {(item.published || isReviewer) && (
              <PortalLink
                href={portalPath(slug, `/read/${item.id}`)}
                className="w-full sm:w-auto sm:self-start"
                aria-label={`Read ${item.title}`}
              >
                <BookIcon className="size-5" />
                Read
              </PortalLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
