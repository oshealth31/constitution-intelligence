import { describe, expect, it } from 'vitest';
import { amountsIn, checkAnswer, type LinkedClause } from './answer-checks';

const quorum: LinkedClause = {
  sectionId: 'x',
  number: '7',
  reference: '7',
  referenceLabel: 'Clause 7',
  location: 'Part 3 · Meetings',
  heading: 'Quorum',
  body: 'The quorum for a general meeting is one third of members.',
  published: true,
};

describe('amountsIn', () => {
  it('reads numbers written as digits, words and fractions the same way', () => {
    expect([
      ...amountsIn('14 days, fourteen days, two-thirds, 2/3, half, 50%, 1,000 pula'),
    ]).toEqual(expect.arrayContaining(['14', '2/3', '1/2', '1000']));
    expect(amountsIn('one third of members')).toEqual(new Set(['1/3']));
  });

  it('leaves clause references out', () => {
    expect(amountsIn('Clause 7 and Part 3 say so')).toEqual(new Set());
  });
});

describe('checkAnswer', () => {
  it('passes an answer that only uses its linked clause', () => {
    expect(checkAnswer('Under Clause 7, a third of members must attend.', [quorum])).toEqual([]);
  });

  it('blocks an answer with no linked clause', () => {
    expect(checkAnswer('Something.', [])).toEqual([
      expect.objectContaining({ code: 'no_clauses', blocking: true }),
    ]);
  });

  it('blocks mentions of clauses that are not linked, but allows the parent of a sub-clause', () => {
    const issues = checkAnswer('Clause 9 says one third.', [quorum]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'unknown_reference', blocking: true }),
    ]);
    const sub = { ...quorum, reference: '7(a)', referenceLabel: 'Clause 7(a)', number: '(a)' };
    expect(checkAnswer('Clause 7(a), part of Clause 7, says one third.', [sub])).toEqual([]);
  });

  it('blocks clauses from versions that are not published', () => {
    expect(checkAnswer('One third.', [{ ...quorum, published: false }])).toEqual([
      expect.objectContaining({ code: 'clause_not_published', blocking: true }),
    ]);
  });

  it('warns about amounts that are not in the linked clauses', () => {
    const issues = checkAnswer('Half of members, with 14 days notice.', [quorum]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'number_not_in_clauses', blocking: false }),
    ]);
    expect(issues[0]!.message).toContain('1/2, 14');
  });
});
