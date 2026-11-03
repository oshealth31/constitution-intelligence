'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  ChevronRightIcon,
  Highlighted,
  Notice,
  PortalButton,
  PortalHeading,
  PortalLoading,
  SearchIcon,
} from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  portalPath,
  sectionAnchor,
  sectionTitle,
  type SearchResponse,
  type SearchResult,
} from '@/lib/portal';
import { usePortal } from '../portal-context';

const EXAMPLES = ['quorum', 'clause 7', 'membership', 'Part 2', 'voting'];

export default function SearchPage() {
  return (
    <Suspense fallback={<PortalLoading />}>
      <Search />
    </Suspense>
  );
}

/** Search the current constitution by word, clause number ("clause 7", "2(a)") or title. */
function Search() {
  const { api, slug } = usePortal();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim();
  const [text, setText] = useState(query);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => setText(query), [query]);

  useEffect(() => {
    if (!query) {
      setResponse(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    apiFetch<SearchResponse>(`${api}/search?q=${encodeURIComponent(query)}`)
      .then((found) => {
        if (!cancelled) setResponse(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, query]);

  function search(value: string) {
    router.replace(portalPath(slug, `/search?q=${encodeURIComponent(value.trim())}`));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    search(text);
  }

  const results = response?.results ?? [];
  const canSearch = text.trim().length >= 2 || /^\d$/.test(text.trim());

  return (
    <div className="max-w-3xl">
      <PortalHeading
        icon={<SearchIcon className="size-6" />}
        title="Search"
        description="Type a word, a clause number (for example “clause 7” or “2(a)”) or the title of a section."
      />
      <form role="search" onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="search-text" className="sr-only">
          What are you looking for?
        </label>
        <input
          id="search-text"
          type="search"
          enterKeyHint="search"
          placeholder="For example: quorum or clause 7"
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          className="block min-h-12 w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none"
        />
        <PortalButton type="submit" disabled={!canSearch}>
          <SearchIcon className="size-5" />
          Search
        </PortalButton>
      </form>
      <p className="mt-2 text-sm text-slate-600">
        Only the current, approved version of each document is searched.
      </p>

      {!query && <Examples onPick={search} />}

      <div className="mt-6" aria-live="polite">
        {loading && <PortalLoading label="Searching…" />}
        {error !== undefined && <Notice tone="error">{describeError(error)}</Notice>}
        {!loading && response && results.length > 0 && (
          <p className="mb-3 text-base text-slate-700">
            {results.length} result{results.length === 1 ? '' : 's'} for “{response.query}”
            {response.interpretedAs ? ` (looking for ${response.interpretedAs.display})` : ''}
          </p>
        )}
        {!loading && response && results.length === 0 && (
          <NoResults response={response} slug={slug} onPick={search} />
        )}
        {!loading && results.length > 0 && (
          <ul className="space-y-3">
            {results.map((result) => (
              <ResultCard key={result.sectionId} result={result} terms={response?.terms ?? []} query={query} slug={slug} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  terms,
  query,
  slug,
}: {
  result: SearchResult;
  terms: string[];
  query: string;
  slug: string;
}) {
  const title =
    result.kind === 'subclause' && !result.heading && result.referenceLabel
      ? result.referenceLabel
      : sectionTitle(result);
  const href = portalPath(
    slug,
    `/read/${result.constitutionId}?version=${result.versionId}&q=${encodeURIComponent(query)}#${sectionAnchor(result.refKey)}`,
  );
  return (
    <li>
      <Link
        href={href}
        className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[var(--brand-accent)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-500">
            {result.constitutionTitle} · {result.versionLabel}
            {result.publishedAt ? ` (published ${formatDate(result.publishedAt)})` : ''}
          </span>
          {result.path.length > 0 && (
            <span className="mt-1 block text-sm text-slate-600">
              {result.path
                .map((item) =>
                  sectionTitle({
                    kind: /^(part|chapter)\b/i.test(item.number ?? '') ? 'part' : 'clause',
                    number: item.number,
                    heading: item.heading,
                  }),
                )
                .join(' › ')}
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-[var(--brand-ink)]">
              <Highlighted text={title} terms={terms} />
            </span>
            {result.referenceLabel && result.referenceLabel !== title && (
              <span className="rounded-full bg-[var(--brand-secondary)] px-2.5 py-0.5 text-sm font-medium text-[var(--brand-on-secondary)]">
                {result.referenceLabel}
              </span>
            )}
          </span>
          {result.excerpt && (
            <span className="mt-1 block text-base whitespace-pre-line text-slate-700">
              <Highlighted text={result.excerpt} terms={terms} />
            </span>
          )}
          {result.sourcePage && (
            <span className="mt-1 block text-sm text-slate-500">Page {result.sourcePage} of the original document</span>
          )}
        </span>
        <ChevronRightIcon className="mt-6 size-6 shrink-0 text-slate-400 group-hover:text-[var(--brand-ink)]" />
      </Link>
    </li>
  );
}

function NoResults({
  response,
  slug,
  onPick,
}: {
  response: SearchResponse;
  slug: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Notice>
        {response.interpretedAs ? (
          <>
            <strong>There is no {response.interpretedAs.display.toLowerCase()} in the current constitution.</strong>{' '}
            Check the number in the Contents list of the document, or search for a word instead.
          </>
        ) : (
          <>
            <strong>Nothing found for “{response.query}”.</strong> The current constitution does not
            use these words.
          </>
        )}
      </Notice>
      {response.suggestions.length > 0 && (
        <div>
          <p className="text-base font-medium text-slate-800">Did you mean:</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {response.suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  onClick={() => onPick(suggestion)}
                  className="min-h-11 rounded-full border border-[var(--brand-accent)] bg-white px-4 text-base font-medium text-slate-900"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-base text-slate-700">
        <p className="font-medium text-slate-900">Tips</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Try one word, for example “meeting” instead of “meetings of the committee”.</li>
          <li>Check the spelling, or try a word with a similar meaning.</li>
          <li>To find a clause by number, type “clause” and the number, for example “clause 7”.</li>
          <li>
            Or browse the whole document:{' '}
            <Link href={portalPath(slug, '/library')} className="font-medium text-[var(--brand-ink)] underline underline-offset-4">
              open Read
            </Link>
            .
          </li>
        </ul>
      </div>
    </div>
  );
}

function Examples({ onPick }: { onPick: (value: string) => void }) {
  return (
    <div className="mt-6">
      <p className="text-base text-slate-600">Not sure what to search for? Try:</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((word) => (
          <li key={word}>
            <button
              type="button"
              onClick={() => onPick(word)}
              className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base font-medium text-slate-800 hover:border-[var(--brand-accent)]"
            >
              {word}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
