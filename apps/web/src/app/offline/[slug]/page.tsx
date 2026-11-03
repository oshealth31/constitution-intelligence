'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ServiceWorkerRegistration } from '@/components/offline-ui';
import { Highlighted, Notice, PortalButton, PortalLoading } from '@/components/portal-ui';
import { brandStyle } from '@/lib/branding';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  freshness,
  searchOffline,
  type OfflineConstitution,
  type OfflineCopy,
  type OfflineSection,
} from '@/lib/offline';
import { deleteCopy, getCopy } from '@/lib/offline-store';
import { syncOfflineCopy } from '@/lib/offline-sync';
import { buildSectionTree, sectionTitle, type SectionNode } from '@/lib/portal';
import { useOnline } from '@/lib/use-online';

type Load = { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; copy: OfflineCopy };
type Update =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'updated' }
  | { kind: 'current' }
  | { kind: 'signed_out' }
  | { kind: 'removed'; reason: string }
  | { kind: 'failed'; message: string };

const anchor = (section: { refKey: string }) => `offline-${section.refKey}`;

/**
 * The offline reader: the approved constitution saved on this device, readable and searchable
 * without a network. It never asks the server for content; when online it only checks whether
 * the saved copy is out of date, and refreshes it if the person is still signed in.
 */
export default function OfflineReaderPage() {
  const { slug } = useParams<{ slug: string }>();
  const online = useOnline();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [update, setUpdate] = useState<Update>({ kind: 'idle' });
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [showSimple, setShowSimple] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void getCopy(slug).then((copy) => setLoad(copy ? { kind: 'ready', copy } : { kind: 'none' }));
  }, [slug]);

  // Back online: check the saved copy against the server (and refresh it if needed).
  const copy = load.kind === 'ready' ? load.copy : null;
  const organisationId = copy?.bundle.organisation.id;
  const userId = copy?.bundle.userId;
  useEffect(() => {
    if (!online || !organisationId || !userId) return;
    let cancelled = false;
    setUpdate({ kind: 'checking' });
    void syncOfflineCopy(slug, organisationId, userId).then((result) => {
      if (cancelled) return;
      if (result.kind === 'updated' || result.kind === 'current') {
        setLoad({ kind: 'ready', copy: result.copy });
        setUpdate({ kind: result.kind });
      } else if (result.kind === 'removed') {
        setLoad({ kind: 'none' });
        setUpdate({ kind: 'removed', reason: result.reason });
      } else if (result.kind === 'signed_out') {
        setUpdate({ kind: 'signed_out' });
      } else if (result.kind === 'failed') {
        setUpdate({ kind: 'failed', message: result.message });
      } else {
        setUpdate({ kind: 'idle' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [online, slug, organisationId, userId]);

  const constitution: OfflineConstitution | undefined = copy?.bundle.constitutions[selected];
  const tree = useMemo(() => buildSectionTree(constitution?.sections ?? []), [constitution]);
  const results = useMemo(
    () => (copy && submitted ? searchOffline(copy.bundle.constitutions, submitted) : null),
    [copy, submitted],
  );
  const hasSimple = constitution?.sections.some((section) => section.simpleWords) ?? false;

  async function clear() {
    await deleteCopy(slug);
    setLoad({ kind: 'none' });
    setConfirmClear(false);
  }

  function goTo(constitutionId: string, section: OfflineSection) {
    const index = copy?.bundle.constitutions.findIndex((item) => item.id === constitutionId) ?? 0;
    setSelected(Math.max(0, index));
    setTimeout(
      () => document.getElementById(anchor(section))?.scrollIntoView({ block: 'start' }),
      0,
    );
  }

  const connection = (
    <p
      data-testid="connection-status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
        online ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-100 text-amber-950'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${online ? 'bg-emerald-600' : 'bg-amber-600'}`}
      />
      {online ? 'Online' : 'Offline'}
    </p>
  );

  if (load.kind === 'loading') {
    return (
      <main className="mx-auto max-w-3xl p-6" style={brandStyle(null)}>
        <ServiceWorkerRegistration />
        <PortalLoading label="Opening the saved copy…" />
      </main>
    );
  }

  if (load.kind === 'none') {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6" style={brandStyle(null)}>
        <ServiceWorkerRegistration />
        {connection}
        <h1 className="text-2xl font-bold text-slate-900">Nothing saved for offline reading</h1>
        {update.kind === 'removed' ? (
          <Notice tone="warning">{update.reason}</Notice>
        ) : (
          <p className="text-base text-slate-700">
            There is no saved copy of this portal’s constitution on this device. When you are
            online, sign in and choose <strong>Save for offline reading</strong> on the home page.
          </p>
        )}
        {online && (
          <a
            href={`/o/${slug}`}
            className="inline-flex min-h-12 items-center font-medium text-[var(--brand-ink)] underline underline-offset-4"
          >
            Go to the portal
          </a>
        )}
      </main>
    );
  }

  const { bundle } = load.copy;
  const state = freshness(load.copy);
  const colours = {
    primary: bundle.organisation.colours.primary ?? undefined,
    accent: bundle.organisation.colours.accent ?? undefined,
    secondary: bundle.organisation.colours.secondary ?? undefined,
  };

  return (
    <div style={brandStyle(colours)} className="min-h-dvh">
      <ServiceWorkerRegistration />
      <header className="bg-[var(--brand-primary)] text-[var(--brand-on-primary)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <p className="text-lg font-semibold">{bundle.organisation.name}</p>
          <p className="text-sm opacity-90">Saved copy for offline reading</p>
          <div className="ml-auto">{connection}</div>
        </div>
        <div className="h-1 bg-[var(--brand-accent)]" />
      </header>

      <main id="main" className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <section
          aria-label="About this copy"
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"
        >
          <p data-testid="last-sync" className="text-base text-slate-800">
            Last synchronised: <strong>{formatDateTime(load.copy.syncedAt)}</strong>
          </p>
          {!online && (
            <Notice tone="warning">
              <strong>You are offline.</strong> You are reading the copy saved on this device. It
              will be checked and updated automatically when the connection returns.
            </Notice>
          )}
          {online && update.kind === 'checking' && (
            <Notice tone="info">Checking for a newer version…</Notice>
          )}
          {online && update.kind === 'updated' && (
            <Notice tone="success">
              A newer version was downloaded. You are reading the latest content.
            </Notice>
          )}
          {online && update.kind === 'current' && (
            <Notice tone="success">The saved copy is up to date.</Notice>
          )}
          {online && update.kind === 'signed_out' && (
            <Notice tone="warning">
              You are online but signed out, so the saved copy could not be checked. It may be out
              of date.{' '}
              <a href={`/o/${slug}/sign-in`} className="font-medium underline underline-offset-4">
                Sign in to update it
              </a>
              .
            </Notice>
          )}
          {online && update.kind === 'failed' && (
            <Notice tone="warning">
              The saved copy could not be checked ({update.message}). It may be out of date.
            </Notice>
          )}
          {state.kind === 'stale' && (
            <Notice tone="warning">
              <strong>This copy may be out of date.</strong> It has not been synchronised for{' '}
              {state.days} days. The constitution may have changed since then.
            </Notice>
          )}
          <Notice tone="info">
            Questions answered by AI need an internet connection and are not available here. Use the
            search below to find clauses in the saved copy. The original document is what counts.
          </Notice>
        </section>

        {state.kind === 'expired' ? (
          <Notice tone="warning">
            <strong>This saved copy has expired</strong> because it has not been synchronised since{' '}
            {formatDate(load.copy.syncedAt)}. Connect to the internet and sign in to update it, so
            you do not rely on rules that may have changed.
          </Notice>
        ) : (
          <>
            {bundle.constitutions.length > 1 && (
              <label className="block text-base font-medium text-slate-900">
                Document
                <select
                  value={selected}
                  onChange={(event) => setSelected(Number(event.target.value))}
                  className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base"
                >
                  {bundle.constitutions.map((item, index) => (
                    <option key={item.id} value={index}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <form
              role="search"
              aria-label="Search the saved copy"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                setSubmitted(query);
              }}
              className="flex flex-wrap gap-2"
            >
              <label htmlFor="offline-search" className="sr-only">
                Search the saved copy
              </label>
              <input
                id="offline-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="A word like “meeting”, or a clause number"
                className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-lg"
              />
              <PortalButton type="submit">Search</PortalButton>
            </form>

            {results && (
              <section aria-label="Search results" className="space-y-2">
                <p className="text-base text-slate-700">
                  {results.hits.length === 0
                    ? `Nothing in the saved copy matches “${submitted}”.`
                    : `${results.hits.length} ${results.hits.length === 1 ? 'match' : 'matches'} in the saved copy`}
                </p>
                <ul className="space-y-2">
                  {results.hits.map((hit) => (
                    <li key={hit.section.id}>
                      <button
                        type="button"
                        onClick={() => goTo(hit.constitutionId, hit.section)}
                        className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-[var(--brand-accent)]"
                      >
                        <span className="block font-semibold text-[var(--brand-ink)]">
                          {hit.section.referenceLabel ?? sectionTitle(hit.section)}
                          {hit.section.heading && hit.section.referenceLabel
                            ? ` · ${hit.section.heading}`
                            : ''}
                        </span>
                        <span className="block text-base text-slate-800">
                          <Highlighted text={hit.excerpt} terms={results.terms} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {constitution && (
              <article
                aria-label={constitution.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 leading-relaxed sm:p-8"
              >
                <h1 className="text-2xl font-bold text-slate-900">{constitution.title}</h1>
                <p data-testid="offline-version" className="mt-1 text-base text-slate-700">
                  Version {constitution.version.versionNumber}: {constitution.version.label}
                  {constitution.version.publishedAt
                    ? ` · published ${formatDate(constitution.version.publishedAt)}`
                    : ''}
                </p>
                {hasSimple && (
                  <PortalButton
                    variant={showSimple ? 'primary' : 'secondary'}
                    aria-pressed={showSimple}
                    className="mt-3"
                    onClick={() => setShowSimple(!showSimple)}
                  >
                    Simple words
                  </PortalButton>
                )}
                {showSimple && bundle.simpleWordsDisclaimer && (
                  <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-base text-amber-950">
                    {bundle.simpleWordsDisclaimer}
                  </p>
                )}
                <nav aria-label="Contents" className="mt-5 rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                    Contents
                  </p>
                  <ul className="mt-2 space-y-1">
                    {tree.map((node) => (
                      <li key={node.id}>
                        <button
                          type="button"
                          onClick={() =>
                            document
                              .getElementById(anchor(node))
                              ?.scrollIntoView({ block: 'start' })
                          }
                          className="min-h-11 text-left text-base font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
                        >
                          {sectionTitle(node)}
                        </button>
                        {node.children.length > 0 && (
                          <ul className="ml-4">
                            {node.children
                              .filter((child) => child.kind !== 'subclause')
                              .map((child) => (
                                <li key={child.id}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      document
                                        .getElementById(anchor(child))
                                        ?.scrollIntoView({ block: 'start' })
                                    }
                                    className="min-h-11 text-left text-base text-[var(--brand-ink)] underline-offset-4 hover:underline"
                                  >
                                    {sectionTitle(child)}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="mt-6">
                  {tree.map((node) => (
                    <OfflineSectionBlock
                      key={node.id}
                      node={node}
                      terms={results?.terms ?? []}
                      showSimple={showSimple}
                    />
                  ))}
                </div>
              </article>
            )}
          </>
        )}

        <section
          aria-label="Remove the saved copy"
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <p className="text-base text-slate-700">
            The saved copy stays on this device until you remove it, sign out, or it is removed
            because your access has ended.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {confirmClear ? (
              <>
                <PortalButton variant="secondary" onClick={() => void clear()}>
                  Yes, remove it from this device
                </PortalButton>
                <PortalButton variant="quiet" onClick={() => setConfirmClear(false)}>
                  Keep it
                </PortalButton>
              </>
            ) : (
              <PortalButton variant="secondary" onClick={() => setConfirmClear(true)}>
                Remove the saved copy from this device
              </PortalButton>
            )}
            {online && (
              <a
                href={`/o/${slug}`}
                className="inline-flex min-h-12 items-center px-3 font-medium text-[var(--brand-ink)] underline underline-offset-4"
              >
                Go to the online portal
              </a>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function OfflineSectionBlock({
  node,
  terms,
  showSimple,
}: {
  node: SectionNode;
  terms: string[];
  showSimple: boolean;
}) {
  const section = node as unknown as OfflineSection & SectionNode;
  const id = anchor(section);
  const simple =
    showSimple && section.simpleWords ? (
      <div
        aria-label={`Simple words for ${section.referenceLabel ?? sectionTitle(section)}`}
        className="mt-2 rounded-xl border-l-4 border-[var(--brand-accent)] bg-[var(--brand-secondary)]/40 px-4 py-3"
      >
        <p className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Simple words · the original wording above is what counts
        </p>
        <p className="mt-1 whitespace-pre-line">{section.simpleWords}</p>
      </div>
    ) : null;
  const children = node.children.map((child) => (
    <OfflineSectionBlock key={child.id} node={child} terms={terms} showSimple={showSimple} />
  ));
  if (node.kind === 'part' || node.kind === 'chapter') {
    return (
      <section className="mt-8 first:mt-0">
        <h2
          id={id}
          className="scroll-mt-4 rounded-xl bg-[var(--brand-secondary)] px-4 py-3 text-xl font-bold text-[var(--brand-on-secondary)]"
        >
          <Highlighted text={sectionTitle(node)} terms={terms} />
        </h2>
        {node.body && (
          <p className="mt-3 whitespace-pre-line">
            <Highlighted text={node.body} terms={terms} />
          </p>
        )}
        {simple}
        {children}
      </section>
    );
  }
  if (node.kind === 'subclause') {
    return (
      <div id={id} className="mt-2 scroll-mt-4 pl-4 sm:pl-8">
        <div className="flex gap-3">
          {node.number && <span className="shrink-0 font-semibold">{node.number}</span>}
          <p className="whitespace-pre-line">
            {node.heading && (
              <strong>
                <Highlighted text={node.heading} terms={terms} />.{' '}
              </strong>
            )}
            <Highlighted text={node.body} terms={terms} />
          </p>
        </div>
        {simple}
        {children}
      </div>
    );
  }
  return (
    <div id={id} className="mt-6 scroll-mt-4">
      <h3 className="text-lg font-semibold text-[var(--brand-ink)]">
        <Highlighted text={sectionTitle(node)} terms={terms} />
      </h3>
      {node.body && (
        <p className="mt-1 whitespace-pre-line">
          <Highlighted text={node.body} terms={terms} />
        </p>
      )}
      {simple}
      {children}
    </div>
  );
}
