'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  ChevronRightIcon,
  Notice,
  PortalButton,
  PortalHeading,
  PortalLoading,
  SearchIcon,
} from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import {
  portalPath,
  sectionAnchor,
  sectionTitle,
  splitHighlights,
  type SearchMatch,
} from '@/lib/portal';
import { usePortal } from '../portal-context';

const SUGGESTIONS = ['meeting', 'quorum', 'membership', 'fees', 'voting'];

export default function SearchPage() {
  return (
    <Suspense fallback={<PortalLoading />}>
      <Search />
    </Suspense>
  );
}

/** Keyword search across the organisation's published constitution. */
function Search() {
  const { api, slug } = usePortal();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim();
  const [text, setText] = useState(query);
  const [results, setResults] = useState<SearchMatch[] | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => setText(query), [query]);

  useEffect(() => {
    if (query.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    apiFetch<SearchMatch[]>(`${api}/search?q=${encodeURIComponent(query)}`)
      .then((found) => {
        if (!cancelled) setResults(found);
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

  return (
    <div className="max-w-3xl">
      <PortalHeading
        icon={<SearchIcon className="size-6" />}
        title="Search"
        description="Type a word or a few words. We will show every part of the constitution that mentions them."
      />
      <form role="search" onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="search-text" className="sr-only">
          What are you looking for?
        </label>
        <input
          id="search-text"
          type="search"
          enterKeyHint="search"
          placeholder="For example: quorum"
          value={text}
          minLength={2}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          className="block min-h-12 w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none"
        />
        <PortalButton type="submit" disabled={text.trim().length < 2}>
          <SearchIcon className="size-5" />
          Search
        </PortalButton>
      </form>

      {!query && (
        <div className="mt-6">
          <p className="text-base text-slate-600">Not sure what to search for? Try:</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((word) => (
              <li key={word}>
                <button
                  type="button"
                  onClick={() => search(word)}
                  className="min-h-11 rounded-full border border-slate-300 bg-white px-4 text-base font-medium text-slate-800 hover:border-[var(--brand-accent)]"
                >
                  {word}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6" aria-live="polite">
        {loading && <PortalLoading label="Searching…" />}
        {error !== undefined && <Notice tone="error">{describeError(error)}</Notice>}
        {!loading && results && (
          <p className="mb-3 text-base text-slate-700">
            {results.length === 0
              ? `Nothing found for “${query}”. Try a shorter or different word.`
              : `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”`}
          </p>
        )}
        {!loading && results && results.length > 0 && (
          <ul className="space-y-3">
            {results.map((match) => (
              <li key={match.sectionId}>
                <Link
                  href={portalPath(
                    slug,
                    `/read/${match.constitutionId}?version=${match.versionId}#${sectionAnchor(match.refKey)}`,
                  )}
                  className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[var(--brand-accent)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-500">{match.constitutionTitle}</span>
                    <span className="mt-0.5 block text-lg font-semibold text-[var(--brand-ink)]">
                      {sectionTitle({
                        kind: 'clause',
                        number: match.number,
                        heading: match.heading,
                      })}
                    </span>
                    <span className="mt-1 block text-base text-slate-700">
                      {splitHighlights(match.snippet).map((part, index) =>
                        part.highlight ? (
                          <mark
                            key={index}
                            className="rounded bg-[var(--brand-accent)] px-0.5 text-[var(--brand-on-accent)]"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </span>
                  <ChevronRightIcon className="mt-6 size-6 shrink-0 text-slate-400 group-hover:text-[var(--brand-ink)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
