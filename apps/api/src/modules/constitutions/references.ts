/**
 * Clause references ("7", "7(a)", "5.1", "Part 3") worked out ONLY from the numbers and
 * headings stored for each section. Nothing is invented: a section without a stored number
 * has no reference.
 *
 * Also: reading a search query as a clause reference ("clause 7", "s. 4.2", "7(a)", "Part III"),
 * search terms, and verbatim excerpts.
 */

export interface ReferenceNode {
  id: string;
  parentSectionId: string | null;
  kind: string;
  number: string | null;
  heading: string | null;
  position: number;
}

export interface SectionReference {
  /** Short reference, e.g. "7(a)", "5.1" or "Part 3". Null when the section has no number. */
  reference: string | null;
  /** How to say it, e.g. "Clause 7(a)" or "Part 3". */
  referenceLabel: string | null;
  /** Ancestor section ids, outermost first. */
  ancestorIds: string[];
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
};

function romanValue(text: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  for (let index = 0; index < text.length; index += 1) {
    const current = values[text[index]!] ?? 0;
    const next = values[text[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

/** "3", "III", "three" or "C" → 3 (for parts and chapters). */
export function divisionValue(token: string): number | null {
  const lower = token.trim().toLowerCase();
  if (/^\d{1,3}$/.test(lower)) return Number(lower);
  if (WORD_NUMBERS[lower]) return WORD_NUMBERS[lower]!;
  if (/^[ivxlc]{1,7}$/.test(lower)) return romanValue(lower);
  if (/^[a-z]$/.test(lower)) return lower.charCodeAt(0) - 96;
  return null;
}

/** The value of a stored part/chapter number such as "Part 3" or "Chapter II". */
export function storedDivisionValue(number: string | null): number | null {
  if (!number) return null;
  const match = /^(?:part|chapter)?\s*(\S+)$/i.exec(number.trim());
  return match ? divisionValue(match[1]!) : null;
}

function cleanNumber(number: string | null): string | null {
  const trimmed = number?.trim().replace(/[.:]+$/, '') ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Works out every section's reference from its own number and its parents' numbers. */
export function computeReferences(nodes: readonly ReferenceNode[]): Map<string, SectionReference> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Map<string, SectionReference>();

  const resolve = (node: ReferenceNode, seen: Set<string>): SectionReference => {
    const cached = result.get(node.id);
    if (cached) return cached;
    const parent =
      node.parentSectionId && !seen.has(node.parentSectionId)
        ? byId.get(node.parentSectionId)
        : undefined;
    const parentRef = parent ? resolve(parent, new Set([...seen, node.id])) : null;
    const ancestorIds = parent && parentRef ? [...parentRef.ancestorIds, parent.id] : [];
    const number = cleanNumber(node.number);
    let reference: string | null = null;
    let referenceLabel: string | null = null;

    if (node.kind === 'part' || node.kind === 'chapter') {
      reference = number;
      referenceLabel = number;
    } else if (number) {
      const bracketed = /^\(.+\)$/.test(number);
      // "(a)" belongs to the nearest numbered clause above it: "7(a)", "7(a)(i)".
      const base =
        bracketed && parentRef?.reference && !/^(part|chapter)\b/i.test(parentRef.reference)
          ? parentRef.reference
          : '';
      reference = `${base}${number}`;
      referenceLabel = /^\d/.test(reference) ? `Clause ${reference}` : `Item ${reference}`;
    }
    const value = { reference, referenceLabel, ancestorIds };
    result.set(node.id, value);
    return value;
  };

  for (const node of [...nodes].sort((a, b) => a.position - b.position)) {
    resolve(node, new Set());
  }
  return result;
}

// ----- Reading a query as a reference --------------------------------------------------------

export type ReferenceQuery =
  | { type: 'division'; kind: 'part' | 'chapter'; value: number; display: string }
  | { type: 'clause'; reference: string; display: string };

const CLAUSE_PREFIX =
  /^(?:clauses?|cl\.?|sections?|sec\.?|s\.|articles?|art\.?|rules?|paragraphs?|para\.?|§)\s*/;

/**
 * Recognises queries such as "7", "clause 7", "Clause 7(a)", "7 (a)", "2a", "s. 4.2",
 * "section 3", "Part 3", "part III". Returns null for ordinary words.
 */
export function parseReferenceQuery(query: string): ReferenceQuery | null {
  const text = query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, '');
  const division = /^(part|chapter) ([0-9]{1,3}|[ivxlc]{1,7}|[a-z]+)$/.exec(text);
  if (division) {
    const value = divisionValue(division[2]!);
    if (value === null) return null;
    const kind = division[1] as 'part' | 'chapter';
    return {
      type: 'division',
      kind,
      value,
      display: `${kind === 'part' ? 'Part' : 'Chapter'} ${value}`,
    };
  }
  const withoutPrefix = text.replace(CLAUSE_PREFIX, '');
  const clause = /^(\d{1,3}(?:\.\d{1,3}){0,3})\s*((?:\(?[a-z]{1,4}\)?\s*){0,3})$/.exec(
    withoutPrefix,
  );
  if (!clause) return null;
  const suffix = [...(clause[2] ?? '').matchAll(/\(?([a-z]{1,4})\)?/g)].map((match) => match[1]!);
  // Each part of the suffix must look like a list label: a letter (or two) or a roman numeral.
  if (!suffix.every((part) => /^[a-z]{1,2}$/.test(part) || /^[ivx]{1,4}$/.test(part))) return null;
  // "1 member" is not a reference: words after the number are only allowed in brackets or as one letter.
  if (suffix.some((part) => part.length > 1 && !/^[ivx]+$/.test(part))) return null;
  const reference = `${clause[1]}${suffix.map((part) => `(${part})`).join('')}`;
  return { type: 'clause', reference, display: `Clause ${reference}` };
}

/** Does this section answer the reference query? */
export function matchesReference(
  query: ReferenceQuery,
  node: Pick<ReferenceNode, 'kind' | 'number'>,
  reference: SectionReference | undefined,
): boolean {
  if (query.type === 'division') {
    return node.kind === query.kind && storedDivisionValue(node.number) === query.value;
  }
  if (node.kind === 'part' || node.kind === 'chapter') return false;
  return reference?.reference?.toLowerCase() === query.reference;
}

// ----- Terms and excerpts ---------------------------------------------------------------------

const IGNORED = new Set(['or', 'and', 'the', 'of', 'a', 'an', 'to', 'in']);

/** The words to highlight for a query (search operators and very common words left out). */
export function searchTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const unique: string[] = [];
  for (const word of words) {
    if (IGNORED.has(word) || unique.includes(word)) continue;
    unique.push(word);
  }
  return unique.slice(0, 10);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A short passage of the ORIGINAL text around the first search term. The words are never
 * changed: the excerpt is an exact slice of the text, with "…" added where text was left out.
 */
export function excerpt(body: string, terms: readonly string[], maxLength = 240): string {
  if (body.length <= maxLength) return body;
  let index = -1;
  for (const term of terms) {
    const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, 'iu').exec(body);
    if (match) {
      const at = match.index + match[1]!.length;
      if (index === -1 || at < index) index = at;
    }
  }
  let start = index <= 0 ? 0 : Math.max(0, index - 80);
  if (start > 0) {
    const space = body.indexOf(' ', start);
    start = space === -1 || space > index ? start : space + 1;
  }
  let end = Math.min(body.length, start + maxLength);
  if (end < body.length) {
    const space = body.lastIndexOf(' ', end);
    if (space > start + maxLength / 2) end = space;
  }
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}
