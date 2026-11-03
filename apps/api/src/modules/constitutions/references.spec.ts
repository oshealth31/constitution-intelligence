import { describe, expect, it } from 'vitest';
import {
  computeReferences,
  excerpt,
  matchesReference,
  parseReferenceQuery,
  searchTerms,
  type ReferenceNode,
} from './references';

const node = (
  id: string,
  parentSectionId: string | null,
  kind: string,
  number: string | null,
  heading: string | null,
  position: number,
): ReferenceNode => ({ id, parentSectionId, kind, number, heading, position });

const nodes = [
  node('p3', null, 'part', 'Part 3', 'Meetings', 0),
  node('c7', 'p3', 'clause', '7', 'Quorum', 1),
  node('c7a', 'c7', 'subclause', '(a)', null, 2),
  node('c7ai', 'c7a', 'subclause', '(i)', null, 3),
  node('c5', 'p3', 'clause', '5.', 'Finance', 4),
  node('c51', 'c5', 'subclause', '5.1', null, 5),
  node('h', 'p3', 'section', null, 'General', 6),
  node('hb', 'h', 'subclause', '(b)', null, 7),
];

describe('clause references', () => {
  const references = computeReferences(nodes);

  it('builds references from stored numbers and parents only', () => {
    expect(references.get('p3')).toMatchObject({ reference: 'Part 3', referenceLabel: 'Part 3' });
    expect(references.get('c7')).toMatchObject({ reference: '7', referenceLabel: 'Clause 7' });
    expect(references.get('c7a')).toMatchObject({ reference: '7(a)', referenceLabel: 'Clause 7(a)' });
    expect(references.get('c7ai')).toMatchObject({ reference: '7(a)(i)', ancestorIds: ['p3', 'c7', 'c7a'] });
    expect(references.get('c5')?.reference).toBe('5'); // trailing "." is not part of the number
    expect(references.get('c51')?.reference).toBe('5.1');
  });

  it('invents nothing for sections without a number', () => {
    expect(references.get('h')).toMatchObject({ reference: null, referenceLabel: null });
    expect(references.get('hb')).toMatchObject({ reference: '(b)', referenceLabel: 'Item (b)' });
  });

  it('survives broken parent links', () => {
    const loop = computeReferences([node('x', 'y', 'clause', '1', null, 0), node('y', 'x', 'subclause', '(a)', null, 1)]);
    expect(loop.get('x')?.reference).toBe('1');
  });
});

describe('reading a query as a reference', () => {
  it.each([
    ['7', '7'],
    ['clause 7', '7'],
    ['Clause 7(a)', '7(a)'],
    ['7 (a)', '7(a)'],
    ['2a', '2(a)'],
    ['s. 4.2', '4.2'],
    ['section 3', '3'],
    ['§4', '4'],
    ['cl. 12', '12'],
    ['7(a)(i)', '7(a)(i)'],
  ])('%s → clause %s', (query, reference) => {
    expect(parseReferenceQuery(query)).toMatchObject({ type: 'clause', reference });
  });

  it.each([
    ['Part 3', 'part', 3],
    ['part III', 'part', 3],
    ['part three', 'part', 3],
    ['Chapter 2', 'chapter', 2],
  ])('%s → %s %i', (query, kind, value) => {
    expect(parseReferenceQuery(query)).toMatchObject({ type: 'division', kind, value });
  });

  it.each(['quorum', '7 members', '1 me', '2026', '(a)', 'general meeting'])('%s is not a reference', (query) => {
    expect(parseReferenceQuery(query)).toBeNull();
  });

  it('matches sections by reference, never parts by clause number', () => {
    const references = computeReferences(nodes);
    expect(matchesReference(parseReferenceQuery('7(a)')!, nodes[2]!, references.get('c7a'))).toBe(true);
    expect(matchesReference(parseReferenceQuery('3')!, nodes[0]!, references.get('p3'))).toBe(false);
    expect(matchesReference(parseReferenceQuery('part iii')!, nodes[0]!, references.get('p3'))).toBe(true);
  });
});

describe('terms and excerpts', () => {
  it('extracts the words to highlight', () => {
    expect(searchTerms('The quorum OR "general meeting" -fees')).toEqual(['quorum', 'general', 'meeting', 'fees']);
  });

  it('keeps the original wording: an excerpt is an exact slice with "…" for left-out text', () => {
    const body = `${'Opening words. '.repeat(30)}The quorum for a general meeting is one third of members. ${'Closing words. '.repeat(30)}`;
    const result = excerpt(body, ['quorum']);
    expect(result.startsWith('…')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(result).toContain('The quorum for a general meeting');
    expect(body).toContain(result.slice(1, -1));
    expect(excerpt('Short text.', ['quorum'])).toBe('Short text.');
  });
});
