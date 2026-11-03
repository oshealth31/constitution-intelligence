/**
 * Offline reading: the shape of the copy a device keeps, how fresh it is, and searching it
 * without a network. Pure functions only (no browser storage here), so they can be tested.
 */
import { queryTerms, type Section } from './portal';

export const OFFLINE_FORMAT = 1;
/** After this many days without a successful check, the copy is shown as possibly out of date. */
export const STALE_AFTER_DAYS = 7;

export interface OfflineSection extends Section {
  simpleWords: string | null;
}

export interface OfflineConstitution {
  id: string;
  title: string;
  version: { id: string; versionNumber: number; label: string; publishedAt: string | null };
  sections: OfflineSection[];
}

/** What the API sends for offline reading (published content only, no personal data). */
export interface OfflineBundle {
  format: number;
  contentHash: string;
  generatedAt: string;
  usableUntil: string;
  userId: string;
  organisation: {
    id: string;
    slug: string;
    name: string;
    colours: { primary: string | null; accent: string | null; secondary: string | null };
  };
  simpleWordsDisclaimer: string | null;
  constitutions: OfflineConstitution[];
}

/** What the device stores for one portal. */
export interface OfflineCopy {
  slug: string;
  bundle: OfflineBundle;
  /** Last time the device confirmed (or downloaded) the latest content. */
  syncedAt: string;
  /** The copy is not shown after this (it must sync again first). */
  usableUntil: string;
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** Refuses anything that is not a well-formed copy (for example from an older app version). */
export function isOfflineBundle(value: unknown): value is OfflineBundle {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<OfflineBundle>;
  return (
    bundle.format === OFFLINE_FORMAT &&
    isString(bundle.contentHash) &&
    isString(bundle.generatedAt) &&
    isString(bundle.usableUntil) &&
    isString(bundle.userId) &&
    !!bundle.organisation &&
    isString(bundle.organisation.id) &&
    isString(bundle.organisation.slug) &&
    isString(bundle.organisation.name) &&
    Array.isArray(bundle.constitutions) &&
    bundle.constitutions.every(
      (constitution) =>
        isString(constitution?.id) &&
        isString(constitution?.title) &&
        !!constitution?.version &&
        Array.isArray(constitution.sections) &&
        constitution.sections.every((section) => isString(section?.id) && isString(section?.body)),
    )
  );
}

export type Freshness =
  | { kind: 'expired' }
  | { kind: 'stale'; days: number }
  | { kind: 'fresh'; days: number };

/** How much the saved copy can be trusted to be current. */
export function freshness(copy: Pick<OfflineCopy, 'syncedAt' | 'usableUntil'>, now = new Date()): Freshness {
  if (now.getTime() > new Date(copy.usableUntil).getTime()) return { kind: 'expired' };
  const days = Math.floor((now.getTime() - new Date(copy.syncedAt).getTime()) / 86_400_000);
  return days >= STALE_AFTER_DAYS ? { kind: 'stale', days } : { kind: 'fresh', days };
}

export interface OfflineHit {
  constitutionId: string;
  section: OfflineSection;
  score: number;
  excerpt: string;
}

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** A short piece of the wording around the first matching word, exactly as stored. */
export function offlineExcerpt(text: string, terms: readonly string[], length = 180): string {
  if (text.length <= length) return text;
  const lower = normalise(text);
  const first = Math.min(
    ...terms.map((term) => lower.indexOf(normalise(term))).filter((index) => index >= 0),
    Number.POSITIVE_INFINITY,
  );
  const start = Number.isFinite(first) ? Math.max(0, first - 50) : 0;
  const piece = text.slice(start, start + length);
  return `${start > 0 ? '…' : ''}${piece}${start + length < text.length ? '…' : ''}`;
}

/**
 * Keyword search of the saved copy, entirely on the device. Matches clause references
 * ("7", "clause 7(a)") and words in headings, text and simple words; every word must appear.
 */
export function searchOffline(
  constitutions: readonly OfflineConstitution[],
  query: string,
  limit = 30,
): { terms: string[]; hits: OfflineHit[] } {
  const trimmed = query.trim();
  if (trimmed.length < 1) return { terms: [], hits: [] };
  const reference = trimmed
    .toLowerCase()
    .replace(/^(?:clause|section|article|rule|cl\.?|s\.)\s*/, '')
    .replace(/\s+/g, '');
  const terms = queryTerms(trimmed);
  const hits: OfflineHit[] = [];
  for (const constitution of constitutions) {
    for (const section of constitution.sections) {
      const ref = (section.reference ?? '').toLowerCase();
      let score = 0;
      if (ref && ref === reference) score += 100;
      const heading = normalise(section.heading ?? '');
      const body = normalise(section.body);
      const simple = normalise(section.simpleWords ?? '');
      if (terms.length > 0) {
        const all = terms.every((term) => {
          const word = normalise(term);
          return heading.includes(word) || body.includes(word) || simple.includes(word);
        });
        if (all) {
          for (const term of terms) {
            const word = normalise(term);
            if (heading.includes(word)) score += 5;
            if (body.includes(word)) score += 2;
            if (simple.includes(word)) score += 1;
          }
        }
      }
      if (score > 0) {
        hits.push({
          constitutionId: constitution.id,
          section,
          score,
          excerpt: offlineExcerpt(section.body || section.heading || '', terms),
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.section.position - b.section.position);
  return { terms, hits: hits.slice(0, limit) };
}
