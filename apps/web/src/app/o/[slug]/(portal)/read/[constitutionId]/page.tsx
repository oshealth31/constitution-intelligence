'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackLink,
  ChevronRightIcon,
  CloseIcon,
  Highlighted,
  ListIcon,
  Notice,
  PortalButton,
  PortalLoading,
} from '@/components/portal-ui';
import { describeError } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import {
  buildSectionTree,
  citation,
  contentsEntries,
  portalPath,
  queryTerms,
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

/**
 * Reading interface: the whole document exactly as stored, with Contents, previous/next
 * navigation, clause references, highlighted search words, text size and the original document.
 */
function Reader() {
  const { api, slug } = usePortal();
  const { constitutionId } = useParams<{ constitutionId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const constitution = useApi<ConstitutionDetail>(`${api}/constitutions/${constitutionId}`);

  const versions = constitution.data?.versions ?? [];
  const requested = searchParams.get('version');
  const query = (searchParams.get('q') ?? '').trim();
  const terms = useMemo(() => (query ? queryTerms(query) : []), [query]);
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
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // While the page scrolls to a section someone chose, scrolling must not change "where am I".
  const jumpedAt = useRef(0);

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
      jumpedAt.current = Date.now();
      target.scrollIntoView({ block: 'start' });
      setHighlighted(hash);
      setCurrentKey(hash.replace(/^section-/, ''));
    }
  }, [sections.data]);

  // Keep track of which part or clause is at the top of the screen, for previous/next.
  useEffect(() => {
    if (contents.length === 0) return;
    const elements = contents
      .map((entry) => document.getElementById(sectionAnchor(entry.refKey)))
      .filter((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible && Date.now() - jumpedAt.current > 1200) {
          setCurrentKey(visible.target.id.replace(/^section-/, ''));
        }
      },
      { rootMargin: '-160px 0px -55% 0px' },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [contents]);

  useEffect(() => {
    if (!contentsOpen) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContentsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contentsOpen]);

  const goTo = useCallback((refKey: string) => {
    const id = sectionAnchor(refKey);
    jumpedAt.current = Date.now();
    setContentsOpen(false);
    setHighlighted(id);
    setCurrentKey(refKey);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#${id}`,
    );
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (constitution.loading) return <PortalLoading />;
  if (constitution.error !== undefined || !constitution.data) {
    return (
      <div>
        <BackLink href={portalPath(slug, '/library')}>Back to Read</BackLink>
        <Notice tone="error">{describeError(constitution.error)}</Notice>
      </div>
    );
  }

  const currentIndex = contents.findIndex((entry) => entry.refKey === currentKey);
  const position = currentIndex === -1 ? 0 : currentIndex;
  const previous = currentIndex > 0 ? contents[currentIndex - 1] : undefined;
  const next = contents[currentIndex === -1 ? 0 : currentIndex + 1];
  const current = currentIndex === -1 ? undefined : contents[currentIndex];
  const highlightedNode = highlighted
    ? (sections.data ?? []).find((section) => sectionAnchor(section.refKey) === highlighted)
    : undefined;

  const contentsList = (
    <ol className="space-y-1">
      {contents.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${sectionAnchor(entry.refKey)}`}
            aria-current={entry.refKey === currentKey ? 'location' : undefined}
            onClick={(event) => {
              event.preventDefault();
              goTo(entry.refKey);
            }}
            className={`block rounded-lg px-3 py-2.5 text-base hover:bg-black/5 ${
              entry.kind === 'part' || entry.kind === 'chapter'
                ? 'mt-2 font-semibold text-slate-900'
                : 'pl-6 text-slate-700'
            } ${entry.refKey === currentKey ? 'bg-[var(--brand-secondary)]' : ''}`}
          >
            {sectionTitle(entry)}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div>
      {query ? (
        <BackLink href={portalPath(slug, `/search?q=${encodeURIComponent(query)}`)}>
          Back to search results
        </BackLink>
      ) : (
        <BackLink href={portalPath(slug, '/library')}>Back to Read</BackLink>
      )}
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
            Version {version.versionNumber}: {version.label}
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

      {query && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base">
          <span>
            Words from your search “<strong>{query}</strong>” are highlighted.
          </span>
          <Link
            href={portalPath(
              slug,
              `/read/${constitutionId}${version ? `?version=${version.id}` : ''}`,
            )}
            className="font-medium text-[var(--brand-ink)] underline underline-offset-4"
          >
            Clear highlighting
          </Link>
        </div>
      )}

      {version && (
        <div className="sticky top-[68px] z-20 -mx-4 mb-4 border-y border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <div className="flex items-center gap-2">
            <PortalButton
              variant="secondary"
              className="px-3 lg:hidden"
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
          {contents.length > 0 && (
            <nav
              aria-label="Section navigation"
              className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2"
            >
              <PortalButton
                variant="secondary"
                className="min-h-11 shrink-0 px-3 py-2 text-sm"
                disabled={!previous}
                onClick={() => previous && goTo(previous.refKey)}
                aria-label={
                  previous ? `Previous section: ${sectionTitle(previous)}` : 'Previous section'
                }
              >
                <ChevronRightIcon className="size-5 rotate-180" />
                <span className="hidden sm:inline">Previous</span>
              </PortalButton>
              <p
                className="min-w-0 flex-1 truncate text-center text-sm text-slate-700"
                aria-live="polite"
              >
                {current ? (
                  <>
                    <span className="font-semibold">
                      {current.referenceLabel ?? sectionTitle(current)}
                    </span>
                    {current.referenceLabel && current.heading ? ` · ${current.heading}` : ''}
                    <span className="text-slate-500">
                      {' '}
                      ({position + 1} of {contents.length})
                    </span>
                  </>
                ) : (
                  `${contents.length} sections`
                )}
              </p>
              <PortalButton
                variant="secondary"
                className="min-h-11 shrink-0 px-3 py-2 text-sm"
                disabled={!next}
                onClick={() => next && goTo(next.refKey)}
                aria-label={next ? `Next section: ${sectionTitle(next)}` : 'Next section'}
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRightIcon className="size-5" />
              </PortalButton>
            </nav>
          )}
        </div>
      )}

      {sections.loading && <PortalLoading label="Loading the document…" />}
      {sections.error !== undefined && (
        <Notice tone="error">{describeError(sections.error)}</Notice>
      )}

      {sections.data && version && (
        <div className="lg:grid lg:grid-cols-[18rem_1fr] lg:gap-8">
          <nav
            aria-label="Contents"
            className="hidden lg:sticky lg:top-48 lg:block lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto"
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
              <SectionBlock
                key={node.id}
                node={node}
                highlighted={highlighted}
                terms={terms}
                referenceCard={
                  highlightedNode ? (
                    <ReferenceCard
                      section={highlightedNode}
                      text={citation(constitution.data!.title, version, highlightedNode)}
                      originalUrl={
                        version.hasOriginal ? `/api/v1${api}/versions/${version.id}/source` : null
                      }
                    />
                  ) : null
                }
              />
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

/** Where the selected section comes from: its reference, the version and the original's page. */
function ReferenceCard({
  section,
  text,
  originalUrl,
}: {
  section: Section;
  text: string;
  originalUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div
      role="note"
      aria-label="Reference for this section"
      className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
    >
      <p>
        <span className="font-semibold text-slate-900">Reference: </span>
        {text}
      </p>
      {section.sourcePage ? (
        <p className="mt-1">Starts on page {section.sourcePage} of the original document.</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-10 font-medium text-[var(--brand-ink)] underline underline-offset-4"
        >
          {copied ? 'Reference copied' : 'Copy reference'}
        </button>
        {originalUrl && (
          <a
            href={originalUrl}
            className="inline-flex min-h-10 items-center font-medium text-[var(--brand-ink)] underline underline-offset-4"
          >
            Open the original document
          </a>
        )}
      </div>
    </div>
  );
}

/** One section and everything inside it. Text is shown exactly as stored, as plain text. */
function SectionBlock({
  node,
  highlighted,
  terms,
  referenceCard,
}: {
  node: SectionNode;
  highlighted: string | null;
  terms: string[];
  referenceCard: ReactNode;
}) {
  const id = sectionAnchor(node.refKey);
  const isHighlighted = highlighted === id;
  const ring = isHighlighted
    ? 'ring-2 ring-[var(--brand-accent)] bg-[var(--brand-secondary)]/40'
    : '';
  const children = node.children.map((child) => (
    <SectionBlock
      key={child.id}
      node={child}
      highlighted={highlighted}
      terms={terms}
      referenceCard={referenceCard}
    />
  ));

  if (node.kind === 'part' || node.kind === 'chapter') {
    return (
      <section aria-labelledby={`${id}-title`} className="mt-8 first:mt-0">
        <h2
          id={id}
          className={`scroll-mt-48 rounded-xl bg-[var(--brand-secondary)] px-4 py-3 text-[1.15em] font-bold text-[var(--brand-on-secondary)] ${ring}`}
        >
          <span id={`${id}-title`}>
            <Highlighted text={sectionTitle(node)} terms={terms} />
          </span>
        </h2>
        {isHighlighted && referenceCard}
        {node.body && (
          <p className="mt-3 whitespace-pre-line">
            <Highlighted text={node.body} terms={terms} />
          </p>
        )}
        {children}
      </section>
    );
  }
  if (node.kind === 'subclause') {
    return (
      <div id={id} className={`mt-2 scroll-mt-48 rounded-lg pl-4 sm:pl-8 ${ring}`}>
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
        {isHighlighted && referenceCard}
        {children}
      </div>
    );
  }
  return (
    <div id={id} className={`mt-6 scroll-mt-48 rounded-lg p-1 ${ring}`}>
      <h3 className="text-[1.05em] font-semibold text-[var(--brand-ink)]">
        <Highlighted text={sectionTitle(node)} terms={terms} />
      </h3>
      {isHighlighted && referenceCard}
      {node.body && (
        <p className="mt-1 whitespace-pre-line">
          <Highlighted text={node.body} terms={terms} />
        </p>
      )}
      {children}
    </div>
  );
}
