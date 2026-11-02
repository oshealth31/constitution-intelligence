'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackLink,
  CloseIcon,
  ListIcon,
  Notice,
  PortalButton,
  PortalLoading,
} from '@/components/portal-ui';
import { describeError } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import {
  buildSectionTree,
  contentsEntries,
  portalPath,
  sectionAnchor,
  sectionTitle,
  type ConstitutionDetail,
  type Section,
  type SectionNode,
} from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const TEXT_SIZES = ['text-base', 'text-lg', 'text-xl', 'text-2xl'] as const;
const SIZE_KEY = 'ci-reading-text-size';

export default function ReadPage() {
  return (
    <Suspense fallback={<PortalLoading />}>
      <Reader />
    </Suspense>
  );
}

/** Reading interface: the whole document, with a Contents list and adjustable text size. */
function Reader() {
  const { api, slug } = usePortal();
  const { constitutionId } = useParams<{ constitutionId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const constitution = useApi<ConstitutionDetail>(`${api}/constitutions/${constitutionId}`);

  const versions = constitution.data?.versions ?? [];
  const requested = searchParams.get('version');
  const version =
    versions.find((item) => item.id === requested) ??
    versions.find((item) => item.status === 'published') ??
    versions[0];
  const sections = useApi<Section[]>(version ? `${api}/versions/${version.id}/sections` : null);
  const tree = useMemo(() => buildSectionTree(sections.data ?? []), [sections.data]);
  const contents = useMemo(() => contentsEntries(tree), [tree]);

  const [size, setSize] = useState(1);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIZE_KEY);
      const saved = stored === null ? Number.NaN : Number(stored);
      if (Number.isInteger(saved) && saved >= 0 && saved < TEXT_SIZES.length) setSize(saved);
    } catch {
      // Storage can be unavailable (private browsing); the default size is fine.
    }
  }, []);

  function changeSize(next: number) {
    const clamped = Math.max(0, Math.min(TEXT_SIZES.length - 1, next));
    setSize(clamped);
    try {
      window.localStorage.setItem(SIZE_KEY, String(clamped));
    } catch {
      // Not saved; it still applies now.
    }
  }

  // Jump to the section named in the address (for example from a search result).
  useEffect(() => {
    if (!sections.data) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      setHighlighted(hash);
    }
  }, [sections.data]);

  useEffect(() => {
    if (!contentsOpen) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContentsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contentsOpen]);

  function goTo(refKey: string) {
    const id = sectionAnchor(refKey);
    setContentsOpen(false);
    setHighlighted(id);
    window.history.replaceState(null, '', `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (constitution.loading) return <PortalLoading />;
  if (constitution.error !== undefined || !constitution.data) {
    return (
      <div>
        <BackLink href={portalPath(slug, '/library')}>Back to Read</BackLink>
        <Notice tone="error">{describeError(constitution.error)}</Notice>
      </div>
    );
  }

  const contentsList = (
    <ol className="space-y-1">
      {contents.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${sectionAnchor(entry.refKey)}`}
            onClick={(event) => {
              event.preventDefault();
              goTo(entry.refKey);
            }}
            className={`block rounded-lg px-3 py-2.5 text-base hover:bg-black/5 ${
              entry.kind === 'part' || entry.kind === 'chapter'
                ? 'mt-2 font-semibold text-slate-900'
                : 'pl-6 text-slate-700'
            } ${highlighted === sectionAnchor(entry.refKey) ? 'bg-[var(--brand-secondary)]' : ''}`}
          >
            {sectionTitle(entry)}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div>
      <BackLink href={portalPath(slug, '/library')}>Back to Read</BackLink>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {constitution.data.title}
        </h1>
        {version && (
          <p className="mt-1 text-base text-slate-600">
            {version.status === 'published' && (
              <span className="mr-2 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200 ring-inset">
                Current approved version
              </span>
            )}
            {version.label}
            {version.publishedAt ? ` · published ${formatDate(version.publishedAt)}` : ''}
          </p>
        )}
        {version?.hasOriginal && (
          <p className="mt-2 text-base">
            <a
              href={`/api/v1${api}/versions/${version.id}/source`}
              className="inline-flex min-h-11 items-center font-medium text-[var(--brand-ink)] underline underline-offset-4"
            >
              Download the original document
            </a>
            <span className="block text-sm text-slate-600">
              The original is the official text. If anything here differs from it, the original is
              correct.
            </span>
          </p>
        )}
      </header>

      {versions.length > 1 && (
        <label className="mb-4 block max-w-md text-base font-medium text-slate-900">
          Version
          <select
            value={version?.id}
            onChange={(event) =>
              router.replace(
                portalPath(slug, `/read/${constitutionId}?version=${event.target.value}`),
              )
            }
            className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base"
          >
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({statusLabel(item.status)})
              </option>
            ))}
          </select>
        </label>
      )}
      {version && version.status !== 'published' && (
        <div className="mb-4">
          <Notice tone="warning">
            You are reading a version that is <strong>{statusLabel(version.status)}</strong>. It is
            not published, so ordinary members cannot see it.
          </Notice>
        </div>
      )}
      {!version && <Notice>This document has no versions yet.</Notice>}

      {version && (
        <div className="sticky top-[68px] z-20 -mx-4 mb-4 flex items-center gap-2 border-y border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <PortalButton
            variant="secondary"
            className="lg:hidden"
            onClick={() => setContentsOpen(true)}
            aria-haspopup="dialog"
          >
            <ListIcon className="size-5" />
            Contents
          </PortalButton>
          <span className="hidden text-base font-medium text-slate-700 lg:inline">Text size</span>
          <div className="ml-auto flex items-center gap-2 lg:ml-2">
            <PortalButton
              variant="secondary"
              className="px-4"
              onClick={() => changeSize(size - 1)}
              disabled={size === 0}
              aria-label="Smaller text"
            >
              A−
            </PortalButton>
            <PortalButton
              variant="secondary"
              className="px-4 text-lg"
              onClick={() => changeSize(size + 1)}
              disabled={size === TEXT_SIZES.length - 1}
              aria-label="Larger text"
            >
              A+
            </PortalButton>
          </div>
        </div>
      )}

      {sections.loading && <PortalLoading label="Loading the document…" />}
      {sections.error !== undefined && (
        <Notice tone="error">{describeError(sections.error)}</Notice>
      )}

      {sections.data && (
        <div className="lg:grid lg:grid-cols-[18rem_1fr] lg:gap-8">
          <nav
            aria-label="Contents"
            className="hidden lg:sticky lg:top-36 lg:block lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto"
          >
            <p className="px-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">
              Contents
            </p>
            {contentsList}
          </nav>
          <article
            className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 leading-relaxed text-slate-900 sm:p-8 ${TEXT_SIZES[size]}`}
          >
            {tree.length === 0 && <p>This version has no sections yet.</p>}
            {tree.map((node) => (
              <SectionBlock key={node.id} node={node} highlighted={highlighted} />
            ))}
            <p className="mt-10 border-t border-slate-200 pt-4 text-base">
              <a
                href="#main"
                className="font-medium text-[var(--brand-ink)] underline underline-offset-4"
              >
                Back to top
              </a>
            </p>
          </article>
        </div>
      )}

      {contentsOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Contents"
        >
          <button
            type="button"
            aria-label="Close contents"
            className="absolute inset-0 bg-black/40"
            onClick={() => setContentsOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="px-3 text-lg font-semibold text-slate-900">Contents</h2>
              <button
                ref={closeButton}
                type="button"
                onClick={() => setContentsOpen(false)}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-base font-medium text-slate-700 hover:bg-black/5"
              >
                <CloseIcon className="size-5" />
                Close
              </button>
            </div>
            {contentsList}
          </div>
        </div>
      )}
    </div>
  );
}

/** One section and everything inside it. Text is always shown as plain text. */
function SectionBlock({ node, highlighted }: { node: SectionNode; highlighted: string | null }) {
  const id = sectionAnchor(node.refKey);
  const isHighlighted = highlighted === id;
  const ring = isHighlighted
    ? 'ring-2 ring-[var(--brand-accent)] bg-[var(--brand-secondary)]/40'
    : '';

  if (node.kind === 'part' || node.kind === 'chapter') {
    return (
      <section aria-labelledby={`${id}-title`} className="mt-8 first:mt-0">
        <h2
          id={id}
          className={`scroll-mt-40 rounded-xl bg-[var(--brand-secondary)] px-4 py-3 text-[1.15em] font-bold text-[var(--brand-on-secondary)] ${ring}`}
        >
          <span id={`${id}-title`}>{sectionTitle(node)}</span>
        </h2>
        {node.body && <p className="mt-3 whitespace-pre-line">{node.body}</p>}
        {node.children.map((child) => (
          <SectionBlock key={child.id} node={child} highlighted={highlighted} />
        ))}
      </section>
    );
  }
  if (node.kind === 'subclause') {
    return (
      <div id={id} className={`mt-2 flex scroll-mt-40 gap-3 rounded-lg pl-4 sm:pl-8 ${ring}`}>
        {node.number && <span className="shrink-0 font-semibold">{node.number}</span>}
        <p className="whitespace-pre-line">
          {node.heading && <strong>{node.heading}. </strong>}
          {node.body}
        </p>
      </div>
    );
  }
  return (
    <div id={id} className={`mt-6 scroll-mt-40 rounded-lg p-1 ${ring}`}>
      <h3 className="text-[1.05em] font-semibold text-[var(--brand-ink)]">{sectionTitle(node)}</h3>
      {node.body && <p className="mt-1 whitespace-pre-line">{node.body}</p>}
      {node.children.map((child) => (
        <SectionBlock key={child.id} node={child} highlighted={highlighted} />
      ))}
    </div>
  );
}
