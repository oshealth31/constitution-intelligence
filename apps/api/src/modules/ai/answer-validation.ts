import { z } from 'zod';
import { parseReferenceQuery } from '../constitutions/references';
import type { Passage } from './ai-prompt';

/**
 * Checks every AI answer on the server BEFORE anyone sees it. Whatever the model writes:
 * - only passages that were actually given to it can be cited;
 * - every quote must be an exact part of that passage's stored text;
 * - the explanation may not mention a clause, section or part number that is not in the
 *   passages given (no invented clause numbers);
 * - the internal instructions must not leak;
 * - an answer without at least one valid citation is treated as "not enough information".
 * Anything that fails becomes the standard "could not find sufficient information" reply.
 */

export type RejectionReason =
  | 'not_json'
  | 'bad_shape'
  | 'unknown_source'
  | 'quote_not_in_source'
  | 'unknown_reference'
  | 'instructions_leaked'
  | 'no_valid_citations'
  | 'model_said_insufficient';

export interface ValidCitation {
  passage: Passage;
  quote: string;
}

export interface ValidatedAnswer {
  status: 'answered' | 'insufficient';
  explanation: string | null;
  citations: ValidCitation[];
  /** Why parts of the answer (or all of it) were thrown away. For logs and tests; never shown. */
  reasons: RejectionReason[];
}

const answerSchema = z.object({
  status: z.enum(['answered', 'insufficient']),
  explanation: z.string().max(4000).optional(),
  citations: z
    .array(z.object({ source: z.string().max(10), quote: z.string().max(2000) }))
    .max(12)
    .optional(),
});

/** Same letters, ignoring differences in spaces, line breaks, quote marks and dashes. */
export function normaliseForComparison(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const REFERENCE_MENTION =
  /\b(clauses?|sections?|articles?|rules?|paragraphs?|parts?|chapters?)\s+((?:\d{1,3}(?:\.\d{1,3})*(?:\s*\([a-z]{1,4}\))*)|[ivxlc]{1,7}\b)/gi;

/** Clause/part references written in a piece of text, normalised ("Clause 7(a)", "Part 3"). */
export function mentionedReferences(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(REFERENCE_MENTION)) {
    const word = match[1]!.toLowerCase().replace(/s$/, '');
    const parsed = parseReferenceQuery(`${word === 'part' || word === 'chapter' ? word : 'clause'} ${match[2]}`);
    if (parsed) found.push(parsed.display);
  }
  return found;
}

/** References a passage makes available: its own and its parents' (all from stored numbers). */
function allowedReferences(passages: readonly Passage[]): Set<string> {
  const allowed = new Set<string>();
  for (const passage of passages) {
    for (const text of [passage.referenceLabel ?? '', passage.location, passage.number ?? '']) {
      for (const reference of mentionedReferences(text)) allowed.add(reference.toLowerCase());
      const parsed = parseReferenceQuery(text.replace(/^Clause /, ''));
      if (parsed) allowed.add(parsed.display.toLowerCase());
    }
    // A parent clause number is allowed when a sub-clause is cited: "7(a)" allows "Clause 7".
    const base = /^(\d{1,3}(?:\.\d{1,3})*)/.exec(passage.reference ?? '');
    if (base) allowed.add(`clause ${base[1]}`);
  }
  return allowed;
}

export function validateAnswer(
  raw: string,
  passages: readonly Passage[],
  secrets: { canary: string; boundary: string },
): ValidatedAnswer {
  const reasons: RejectionReason[] = [];
  const insufficient = (reason: RejectionReason): ValidatedAnswer => ({
    status: 'insufficient',
    explanation: null,
    citations: [],
    reasons: [...reasons, reason],
  });

  if (raw.includes(secrets.canary) || raw.includes(secrets.boundary)) {
    return insufficient('instructions_leaked');
  }
  const parsed = answerSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    return insufficient(extractJson(raw) === undefined ? 'not_json' : 'bad_shape');
  }
  if (parsed.data.status === 'insufficient') {
    return insufficient('model_said_insufficient');
  }

  const byId = new Map(passages.map((passage) => [passage.id, passage]));
  const citations: ValidCitation[] = [];
  for (const citation of parsed.data.citations ?? []) {
    const passage = byId.get(citation.source.trim().toUpperCase());
    if (!passage) {
      reasons.push('unknown_source');
      continue;
    }
    // Quote marks the model put around the quote are not part of it.
    const quote = citation.quote.trim().replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '').trim();
    const source = normaliseForComparison(`${passage.heading ?? ''}\n${passage.body}`);
    if (quote.length < 3 || !source.includes(normaliseForComparison(quote))) {
      reasons.push('quote_not_in_source');
      continue;
    }
    // Keep the passage's own wording for the quote (never the model's version of it).
    const exact = exactSlice(passage.body, quote) ?? exactSlice(passage.heading ?? '', quote) ?? quote;
    if (!citations.some((item) => item.passage.id === passage.id && item.quote === exact)) {
      citations.push({ passage, quote: exact });
    }
  }

  const explanation = (parsed.data.explanation ?? '').trim();
  const allowed = allowedReferences(passages);
  for (const reference of mentionedReferences(explanation)) {
    if (!allowed.has(reference.toLowerCase())) {
      return insufficient('unknown_reference');
    }
  }
  if (citations.length === 0) {
    return insufficient('no_valid_citations');
  }
  return { status: 'answered', explanation: explanation || null, citations, reasons };
}

/** Finds `quote` in `text` ignoring spacing/quote-mark differences and returns the text's own slice. */
function exactSlice(text: string, quote: string): string | null {
  const target = normaliseForComparison(quote);
  if (!target) return null;
  // Map each character of the normalised text back to the original text.
  const words = target.split(' ');
  const pattern = new RegExp(
    words
      .map((word) =>
        [...word]
          .map((char) => {
            if (char === "'") return "['‘’‚′]";
            if (char === '"') return '["“”„″]';
            if (char === '-') return '[-‐-―−]';
            return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join(''),
      )
      .join('\\s+'),
    'iu',
  );
  const match = pattern.exec(text.normalize('NFKC'));
  return match ? match[0] : null;
}
