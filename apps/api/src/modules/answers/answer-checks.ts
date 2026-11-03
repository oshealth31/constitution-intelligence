/**
 * Automatic checks run on an approved-answer draft before an owner or administrator can approve
 * it. They catch mechanical mistakes; they cannot tell whether the answer is a fair reading of the
 * clauses. That is what the person approving it is for.
 *
 *  - blocking: the answer cannot be approved until it is fixed;
 *  - warning:  shown to the person approving, who must check it against the original.
 */
import { allowedReferences, mentionedReferences } from '../ai/answer-validation';

export interface LinkedClause {
  sectionId: string;
  number: string | null;
  reference: string | null;
  referenceLabel: string | null;
  /** Titles of the parts/clauses the section sits in. */
  location: string;
  heading: string | null;
  body: string;
  /** True when the section belongs to a currently published version. */
  published: boolean;
}

export type CheckCode =
  | 'no_clauses'
  | 'clause_not_published'
  | 'unknown_reference'
  | 'number_not_in_clauses';

export interface CheckIssue {
  code: CheckCode;
  blocking: boolean;
  message: string;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  ninety: '90',
  hundred: '100',
};

const FRACTIONS: [RegExp, string][] = [
  [/\b(?:two|2)[\s-]+thirds?\b|\b2\/3\b/g, '2/3'],
  [/\b(?:three|3)[\s-]+quarters?\b|\b3\/4\b|\b75\s?%|\b75 per ?cent\b/g, '3/4'],
  [/\b(?:one|a|1)[\s-]+thirds?\b|\b1\/3\b/g, '1/3'],
  [/\b(?:one|a|1)[\s-]+quarters?\b|\b1\/4\b|\b25\s?%|\b25 per ?cent\b/g, '1/4'],
  [/\bhalf\b|\b1\/2\b|\b50\s?%|\b50 per ?cent\b/g, '1/2'],
];

const REFERENCE_MENTION =
  /\b(?:clauses?|sections?|articles?|rules?|paragraphs?|parts?|chapters?)\s+(?:\d{1,3}(?:\.\d{1,3})*(?:\s*\([a-z]{1,4}\))*|[ivxlc]{1,7}\b)/gi;

/**
 * The amounts in a text, written one way ("14", "fourteen" → "14"; "two thirds", "2/3" → "2/3").
 * Clause references ("Clause 7") are left out: they are checked separately.
 */
export function amountsIn(text: string): Set<string> {
  let lower = text.toLowerCase().replace(REFERENCE_MENTION, ' ');
  const found = new Set<string>();
  for (const [pattern, value] of FRACTIONS) {
    lower = lower.replace(pattern, () => {
      found.add(value);
      return ' ';
    });
  }
  for (const match of lower.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g)) {
    found.add(match[0].replace(/,/g, ''));
  }
  for (const match of lower.matchAll(/\b[a-z]+\b/g)) {
    const value = NUMBER_WORDS[match[0]];
    if (value) found.add(value);
  }
  return found;
}

export function checkAnswer(answer: string, clauses: readonly LinkedClause[]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (clauses.length === 0) {
    issues.push({
      code: 'no_clauses',
      blocking: true,
      message: 'Link at least one clause that this answer is based on.',
    });
    return issues;
  }

  const unpublished = clauses.filter((clause) => !clause.published);
  if (unpublished.length > 0) {
    issues.push({
      code: 'clause_not_published',
      blocking: true,
      message: `${unpublished
        .map((clause) => clause.referenceLabel ?? clause.heading ?? 'A linked clause')
        .join(
          ', ',
        )} is not part of the current published constitution. Link the clause from the current version instead.`,
    });
  }

  const allowed = allowedReferences(clauses);
  const unknown = [
    ...new Set(
      mentionedReferences(answer).filter((reference) => !allowed.has(reference.toLowerCase())),
    ),
  ];
  if (unknown.length > 0) {
    issues.push({
      code: 'unknown_reference',
      blocking: true,
      message: `The answer mentions ${unknown.join(', ')}, which ${
        unknown.length === 1 ? 'is' : 'are'
      } not among the linked clauses. Link ${
        unknown.length === 1 ? 'it' : 'them'
      } or remove the mention.`,
    });
  }

  const inClauses = new Set<string>();
  for (const clause of clauses) {
    for (const amount of amountsIn(`${clause.heading ?? ''} ${clause.body}`)) inClauses.add(amount);
  }
  const missing = [...amountsIn(answer)].filter((amount) => !inClauses.has(amount));
  if (missing.length > 0) {
    issues.push({
      code: 'number_not_in_clauses',
      blocking: false,
      message: `Please check: the answer contains ${missing.join(', ')}, which ${
        missing.length === 1 ? 'does' : 'do'
      } not appear in the linked clauses.`,
    });
  }
  return issues;
}

export const hasBlockingIssue = (issues: readonly CheckIssue[]) =>
  issues.some((issue) => issue.blocking);
