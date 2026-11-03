'use client';

import {
  ActionTile,
  BookIcon,
  ChatIcon,
  PortalLink,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from '@/components/portal-ui';
import { formatDate } from '@/lib/format';
import { canManage, portalPath } from '@/lib/portal';
import { OfflineCard } from '@/components/offline-ui';
import { usePortal } from './portal-context';

/** Organisation home page: welcome message and the main things people come to do. */
export default function PortalHomePage() {
  const { home, user, slug, aiAvailable } = usePortal();
  const { organisation, library } = home;
  const first = library.firstPublished;
  const firstName = user.displayName.split(/\s+/)[0] ?? user.displayName;

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="welcome-heading"
        className="overflow-hidden rounded-3xl bg-[var(--brand-secondary)] text-[var(--brand-on-secondary)]"
      >
        <div className="border-l-[6px] border-[var(--brand-accent)] p-6 sm:p-8">
          <p className="text-base font-medium opacity-80">Hello, {firstName}</p>
          <h1 id="welcome-heading" className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome to {organisation.name}
          </h1>
          {organisation.welcomeMessage ? (
            // Shown as plain text: line breaks are kept, nothing in it is treated as code.
            <p data-testid="welcome-message" className="mt-3 max-w-3xl text-lg whitespace-pre-line">
              {organisation.welcomeMessage}
            </p>
          ) : (
            <p className="mt-3 max-w-3xl text-lg">
              Read your organisation’s constitution and find any rule quickly.
            </p>
          )}
          {first?.published && (
            <PortalLink
              href={portalPath(slug, `/read/${first.id}`)}
              className="mt-6 w-full sm:w-auto"
            >
              <BookIcon className="size-5" />
              Read the constitution
            </PortalLink>
          )}
        </div>
      </section>

      {library.published > 0 && (
        <OfflineCard slug={slug} organisationId={organisation.id} userId={user.id} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ActionTile
          href={portalPath(slug, '/library')}
          icon={<BookIcon className="size-6" />}
          title="Read"
          description={
            library.published === 1
              ? '1 constitution is available to read.'
              : `${library.published} documents are available to read.`
          }
        />
        <ActionTile
          href={portalPath(slug, '/search')}
          icon={<SearchIcon className="size-6" />}
          title="Search"
          description="Type a word like “meeting” or “fees” to find the right rule."
        />
        <ActionTile
          href={portalPath(slug, '/ask')}
          icon={<ChatIcon className="size-6" />}
          title={aiAvailable ? 'Ask a question' : 'Find relevant clauses'}
          description={
            aiAvailable
              ? 'Ask in your own words and see the clauses the answer comes from.'
              : 'Type a question in your own words to see the clauses that match it.'
          }
        />
        {canManage(home.you.permissions) && (
          <ActionTile
            href={portalPath(slug, '/manage')}
            icon={<SettingsIcon className="size-6" />}
            title="Manage"
            description="Branding, members and the approval status of documents."
          />
        )}
        <ActionTile
          href={portalPath(slug, '/profile')}
          icon={<UserIcon className="size-6" />}
          title="My profile"
          description={`Signed in as ${user.email} · ${home.you.roleLabel}`}
        />
      </div>

      {first?.published && (
        <p className="text-sm text-slate-600">
          Current version: {first.published.label}
          {first.published.publishedAt
            ? `, published ${formatDate(first.published.publishedAt)}`
            : ''}
          .
        </p>
      )}
    </div>
  );
}
