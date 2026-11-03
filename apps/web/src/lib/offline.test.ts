import { describe, expect, it } from 'vitest';
import {
  freshness,
  isOfflineBundle,
  offlineExcerpt,
  searchOffline,
  type OfflineBundle,
  type OfflineConstitution,
  type OfflineSection,
} from './offline';

const section = (overrides: Partial<OfflineSection> & Pick<OfflineSection, 'id' | 'position'>): OfflineSection => ({
  parentSectionId: null,
  kind: 'clause',
  refKey: overrides.id,
  number: null,
  heading: null,
  body: '',
  reference: null,
  referenceLabel: null,
  simpleWords: null,
  ...overrides,
});

const constitution: OfflineConstitution = {
  id: 'c1',
  title: 'Constitution',
  version: { id: 'v1', versionNumber: 2, label: 'Amended 2026', publishedAt: '2026-10-01T00:00:00Z' },
  sections: [
    section({ id: 's1', position: 0, number: '7', heading: 'Quorum', reference: '7', referenceLabel: 'Clause 7', body: 'The quorum for a general meeting is one third of members.' }),
    section({ id: 's2', position: 1, number: '8', heading: 'Voting', reference: '8', referenceLabel: 'Clause 8', body: 'Each member has one vote.', simpleWords: 'Everyone gets a single vote at meetings.' }),
    section({ id: 's3', position: 2, number: '(a)', kind: 'subclause', reference: '8(a)', referenceLabel: 'Clause 8(a)', body: 'The chairperson has a casting vote.' }),
  ],
};

const bundle: OfflineBundle = {
  format: 1,
  contentHash: 'abc',
  generatedAt: '2026-11-01T00:00:00Z',
  usableUntil: '2026-12-01T00:00:00Z',
  userId: 'u1',
  organisation: { id: 'o1', slug: 'choir', name: 'Choir', colours: { primary: null, accent: null, secondary: null } },
  simpleWordsDisclaimer: null,
  constitutions: [constitution],
};

describe('isOfflineBundle', () => {
  it('accepts a well-formed copy and refuses anything else', () => {
    expect(isOfflineBundle(bundle)).toBe(true);
    expect(isOfflineBundle({ ...bundle, format: 2 })).toBe(false);
    expect(isOfflineBundle({ ...bundle, constitutions: [{ id: 'x' }] })).toBe(false);
    expect(isOfflineBundle(null)).toBe(false);
    expect(isOfflineBundle('text')).toBe(false);
  });
});

describe('freshness', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  it('is fresh for a recent sync, stale after a week, and expired after its usable date', () => {
    expect(freshness({ syncedAt: '2026-11-09T00:00:00Z', usableUntil: '2026-12-01T00:00:00Z' }, now)).toEqual({ kind: 'fresh', days: 1 });
    expect(freshness({ syncedAt: '2026-11-01T00:00:00Z', usableUntil: '2026-12-01T00:00:00Z' }, now)).toEqual({ kind: 'stale', days: 9 });
    expect(freshness({ syncedAt: '2026-09-01T00:00:00Z', usableUntil: '2026-10-01T00:00:00Z' }, now)).toEqual({ kind: 'expired' });
  });
});

describe('searchOffline', () => {
  it('finds words in headings, text and simple words, best first', () => {
    const { hits, terms } = searchOffline([constitution], 'vote');
    expect(terms).toEqual(['vote']);
    expect(hits.map((hit) => hit.section.id)).toEqual(['s2', 's3']);
    expect(searchOffline([constitution], 'single').hits.map((hit) => hit.section.id)).toEqual(['s2']);
  });

  it('needs every word, and finds clause references', () => {
    expect(searchOffline([constitution], 'quorum vote').hits).toEqual([]);
    expect(searchOffline([constitution], 'clause 8(a)').hits[0]?.section.id).toBe('s3');
    expect(searchOffline([constitution], 'Quorum').hits[0]?.section.id).toBe('s1');
  });

  it('returns nothing for an empty search', () => {
    expect(searchOffline([constitution], '   ').hits).toEqual([]);
  });
});

describe('offlineExcerpt', () => {
  it('keeps short text whole and cuts long text around the first match', () => {
    expect(offlineExcerpt('Short text.', ['text'])).toBe('Short text.');
    const long = `${'Lorem ipsum '.repeat(30)}the quorum rule ${'dolor sit '.repeat(30)}`;
    const excerpt = offlineExcerpt(long, ['quorum']);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt).toContain('quorum');
    expect(excerpt.length).toBeLessThan(200);
  });
});
