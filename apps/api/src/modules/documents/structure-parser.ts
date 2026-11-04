import type { ExtractedLine, ExtractionIssue } from './extraction-types';

/**
 * Turns extracted lines into a constitution's structure: parts/chapters, numbered clauses and
 * lettered or numbered sub-clauses, each with its number, heading and text.
 *
 * It never invents content. Anything it is unsure about is FLAGGED for a person to check
 * (needsReview + a plain-language reason), and problems with the document as a whole are
 * returned as issues.
 */

export type SectionKind = 'part' | 'chapter' | 'section' | 'clause' | 'subclause';

export interface ParsedSection {
  key: string;
  parentKey: string | null;
  kind: SectionKind;
  number: string | null;
  heading: string | null;
  body: string;
  needsReview: boolean;
  reviewReason: string | null;
  page: number | null;
}

export interface ParseResult {
  title: string | null;
  sections: ParsedSection[];
  issues: ExtractionIssue[];
  characterCount: number;
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

const DIVISION =
  /^(part|chapter)\s+([0-9]{1,3}|[ivxlc]{1,7}|[a-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b\s*[:.\-–—]?\s*(.*)$/i;
const ARTICLE = /^(article|section|clause|rule)\s+(\d{1,3}[a-z]?)\b\s*[:.\-–—]?\s*(.*)$/i;
const DECIMAL = /^(\d{1,3}(?:\.\d{1,3}){0,3})(\.|\))?\s+(\S.*)$/;
const DECIMAL_ONLY = /^(\d{1,3}(?:\.\d{1,3}){0,3})(\.|\))?$/;
const BRACKETED = /^\(([a-z]{1,2}|[ivx]{1,6}|\d{1,2})\)\s*(.*)$/i;
const LETTER_DOT = /^([a-z])[.)]\s+(\S.*)$/;
const GARBLED = /�|\(cid:\d+\)/;
const LONG_SECTION = 4000;

function romanValue(text: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  const lower = text.toLowerCase();
  for (let index = 0; index < lower.length; index += 1) {
    const current = values[lower[index]!] ?? 0;
    const next = values[lower[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

function divisionNumber(token: string): number | null {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  if (WORD_NUMBERS[lower]) return WORD_NUMBERS[lower]!;
  if (/^[ivxlc]+$/.test(lower)) return romanValue(lower);
  if (/^[a-z]$/.test(lower)) return lower.charCodeAt(0) - 96;
  return null;
}

function isShortTitle(text: string): boolean {
  const words = text.split(/\s+/).length;
  return words <= 12 && text.length <= 100 && !/[.;:,]$/.test(text);
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function looksGarbled(text: string): boolean {
  if (GARBLED.test(text)) return true;
  if (text.length < 40) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters / text.length < 0.45;
}

/** Splits "Quorum. The quorum is..." into a heading and text when that is clearly the pattern. */
function splitHeading(rest: string): { heading: string | null; body: string } {
  const inline = /^([A-Z][^.:;]{1,60})[.:]\s+(\S[\s\S]*)$/.exec(rest);
  if (inline && inline[1]!.split(/\s+/).length <= 6) {
    return { heading: inline[1]!.trim(), body: inline[2]!.trim() };
  }
  return { heading: null, body: rest };
}

type ListStyle = 'letter' | 'roman' | 'number';

/** One way of reading a list item's label: "(i)" can be the letter i (9th) or roman one. */
interface ListReading {
  style: ListStyle;
  value: number;
}

/** A list that is open at some depth, e.g. the (a), (b) items inside clause 14.1.3 (i). */
interface OpenList {
  style: ListStyle;
  /** The last item's value and label, to recognise the next one ("(ii)" after "(i)"). */
  value: number;
  number: string;
  /** The section the list's items belong to. */
  owner: ParsedSection | null;
  /** The list's latest item: a new list that starts now goes inside it. */
  last: ParsedSection;
}

interface Marker {
  kind: SectionKind;
  number: string;
  /** Sort value used to check numbering order within the same parent. */
  value: number | null;
  /** For decimal numbers: "3.2" → ["3","2"]. */
  path?: string[];
  /** For list items such as (a), (ii), (3): every possible reading of the label. */
  readings?: ListReading[];
  rest: string;
}

function letterValue(token: string): number {
  // (a)–(z), then (aa), (bb), ... as some documents continue long lists.
  if (token.length === 1) return token.charCodeAt(0) - 96;
  if (token.length === 2 && token[0] === token[1]) return 26 + token.charCodeAt(0) - 96;
  return 0;
}

function listReadings(token: string): ListReading[] {
  if (/^\d+$/.test(token)) return [{ style: 'number', value: Number(token) }];
  const readings: ListReading[] = [];
  const letter = letterValue(token);
  if (letter > 0) readings.push({ style: 'letter', value: letter });
  if (/^[ivx]+$/.test(token)) readings.push({ style: 'roman', value: romanValue(token) });
  return readings;
}

export function parseStructure(input: ExtractedLine[]): ParseResult {
  const issues: ExtractionIssue[] = [];
  const sections: ParsedSection[] = [];
  const usedKeys = new Set<string>();
  let characterCount = 0;

  const lines = input
    .map((line) => ({
      ...line,
      text: (line.autoNumber ? `${line.autoNumber} ${line.text}` : line.text)
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((line) => line.text.length > 0);
  for (const line of lines) characterCount += line.text.length;

  if (characterCount === 0) {
    issues.push({
      code: 'no_text',
      severity: 'error',
      message:
        'No text could be read from this document. It may be a scanned picture. Scanned documents cannot be read automatically yet; please upload a Word document or a PDF that contains text.',
    });
    return { title: null, sections, issues, characterCount };
  }
  if (characterCount < 200) {
    issues.push({
      code: 'little_text',
      severity: 'warning',
      message: 'Very little text was found. Please check that the whole document was read.',
    });
  }

  const makeKey = (base: string) => {
    const clean =
      base
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 56) || 's';
    let key = clean;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${clean}-${suffix++}`;
    usedKeys.add(key);
    return key;
  };

  // Current position in the structure.
  let division: ParsedSection | null = null; // part / chapter / unnumbered heading
  let clause: ParsedSection | null = null; // top-level numbered clause
  const decimalChain = new Map<string, ParsedSection>(); // "3", "3.2" → section
  let bracketParent: ParsedSection | null = null; // clause or sub-clause that owns (a), (b)
  // Lists open under bracketParent, outermost first: e.g. [(i), (ii) list] then [(a), (b) list].
  let lists: OpenList[] = [];
  /** The open list a reading would continue ("(ii)" after "(i)"), searching from the innermost. */
  const continuing = (readings: ListReading[]) => {
    for (let depth = lists.length - 1; depth >= 0; depth -= 1) {
      const list = lists[depth]!;
      const reading = readings.find(
        (candidate) => candidate.style === list.style && candidate.value === list.value + 1,
      );
      if (reading) return { depth, reading };
    }
    return null;
  };
  // Assigned inside add(); the type assertion stops TypeScript assuming it is always null.
  let current = null as ParsedSection | null;
  let title: string | null = null;
  let anyMarker = false;

  const flag = (section: ParsedSection, reason: string) => {
    section.needsReview = true;
    section.reviewReason = section.reviewReason ? `${section.reviewReason} ${reason}` : reason;
  };

  const add = (
    section: Omit<ParsedSection, 'key' | 'needsReview' | 'reviewReason'> & { keyBase: string },
  ) => {
    const { keyBase, ...rest } = section;
    const created: ParsedSection = {
      ...rest,
      key: makeKey(keyBase),
      needsReview: false,
      reviewReason: null,
    };
    sections.push(created);
    current = created;
    return created;
  };

  const appendText = (text: string, newParagraph: boolean) => {
    if (!current) return;
    if (!current.body) current.body = text;
    else if (current.body.endsWith('-') && /^[a-z]/.test(text))
      current.body = current.body.slice(0, -1) + text;
    else current.body += (newParagraph ? '\n' : ' ') + text;
  };

  const classify = (line: ExtractedLine, _previous: string | undefined): Marker | null => {
    const text = line.text;
    let match = DIVISION.exec(text);
    if (match) {
      const kind = match[1]!.toLowerCase() === 'chapter' ? 'chapter' : 'part';
      return {
        kind,
        number: `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()} ${match[2]}`,
        value: divisionNumber(match[2]!),
        rest: match[3]!.trim(),
      };
    }
    match = ARTICLE.exec(text);
    if (match) {
      return {
        kind: 'clause',
        number: match[2]!,
        value: Number.parseInt(match[2]!, 10),
        path: [match[2]!],
        rest: match[3]!.trim(),
      };
    }
    match = DECIMAL.exec(text);
    const alone = match ? null : DECIMAL_ONLY.exec(text);
    if (match || alone) {
      const numberText = (match ?? alone)![1]!;
      const mark = (match ?? alone)![2];
      const rest = match ? match[3]! : '';
      const path = numberText.split('.').filter(Boolean);
      const top = Number(path[0]);
      // "2026 members attended" is a sentence, not clause 2026: a clause number needs a "." or ")",
      // a dotted form (3.2), Word's own numbering, or a short heading after it ("1 Name").
      const plausible =
        top <= 300 &&
        (Boolean(mark) || path.length > 1 || line.autoNumber !== undefined || isShortTitle(rest));
      if (plausible) {
        return {
          kind: path.length === 1 ? 'clause' : 'subclause',
          number: path.join('.'),
          value: Number(path[path.length - 1]),
          path,
          rest: rest.trim(),
        };
      }
    }
    match = BRACKETED.exec(text);
    if (match) {
      const token = match[1]!.toLowerCase();
      const readings = listReadings(token);
      return {
        kind: 'subclause',
        number: `(${token})`,
        value: readings[0]?.value ?? 0,
        readings,
        rest: match[2]!.trim(),
      };
    }
    // "a. text": only when it starts a list or continues an open lettered list, so ordinary
    // sentences beginning with "a." are not mistaken for items.
    match = LETTER_DOT.exec(text);
    if (match) {
      const readings: ListReading[] = [{ style: 'letter', value: letterValue(match[1]!) }];
      if (match[1] === 'a' || continuing(readings)) {
        return {
          kind: 'subclause',
          number: `(${match[1]})`,
          value: readings[0]!.value,
          readings,
          rest: match[2]!.trim(),
        };
      }
    }
    return null;
  };

  // Numbering order checks, per parent and level.
  const lastValue = new Map<string, { value: number; number: string }>();
  const checkOrder = (
    scope: string,
    section: ParsedSection,
    value: number | null,
    label: string,
  ) => {
    if (value === null) return;
    const previous = lastValue.get(scope);
    if (previous) {
      if (value === previous.value) {
        flag(section, `The number ${section.number} appears more than once here.`);
      } else if (value > previous.value + 1) {
        flag(
          section,
          `${label} ${section.number} follows ${previous.number}. Something in between may be missing or was not recognised.`,
        );
      } else if (value < previous.value) {
        flag(
          section,
          `${label} ${section.number} comes after ${previous.number}, which is out of order.`,
        );
      }
    }
    lastValue.set(scope, { value, number: section.number ?? '' });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const next = lines[index + 1];
    const previousText = lines[index - 1]?.text;
    const marker = classify(line, previousText);

    if (!marker) {
      // Title: a heading-styled or capitalised line before anything else.
      if (
        !anyMarker &&
        !current &&
        title === null &&
        (line.headingLevel === 0 || line.headingLevel === 1 || isAllCaps(line.text)) &&
        isShortTitle(line.text)
      ) {
        title = line.text;
        continue;
      }
      // Unnumbered heading (Word heading style, larger PDF text or a short capitalised line)
      // followed by more content: becomes a heading section of its own.
      const headingLike =
        (line.headingLevel !== undefined && line.headingLevel <= 2) ||
        (isAllCaps(line.text) && isShortTitle(line.text));
      if (headingLike && isShortTitle(line.text) && next) {
        // A short heading directly after a numbered clause with no text yet names that clause.
        if (
          current &&
          current.kind !== 'part' &&
          current.kind !== 'chapter' &&
          !current.heading &&
          !current.body
        ) {
          current.heading = line.text;
          continue;
        }
        division = add({
          keyBase: `heading-${line.text}`,
          parentKey: null,
          kind: 'section',
          number: null,
          heading: line.text,
          body: '',
          page: line.page ?? null,
        });
        clause = null;
        bracketParent = null;
        lists = [];
        decimalChain.clear();
        lastValue.delete('clause');
        continue;
      }
      if (!current) {
        add({
          keyBase: 'preamble',
          parentKey: null,
          kind: 'section',
          number: null,
          heading: 'Preamble',
          body: '',
          page: line.page ?? null,
        });
      }
      // A short line right after a clause number with no wording yet is the clause heading.
      if (
        current &&
        current.kind !== 'part' &&
        current.kind !== 'chapter' &&
        current.kind !== 'section' &&
        !current.heading &&
        !current.body &&
        isShortTitle(line.text) &&
        next &&
        !classify(next, line.text)
      ) {
        current.heading = line.text;
        continue;
      }
      // Word paragraphs are separate paragraphs; PDF lines continue unless a sentence ended.
      appendText(line.text, line.page === undefined ? true : /[.:;]$/.test(previousText ?? ''));
      continue;
    }

    anyMarker = true;
    if (marker.kind === 'part' || marker.kind === 'chapter') {
      let heading = marker.rest || null;
      // "PART 2" on one line and its name on the next.
      if (!heading && next && !classify(next, line.text) && isShortTitle(next.text)) {
        heading = next.text;
        index += 1;
      }
      division = add({
        keyBase: `${marker.kind}-${marker.number.split(' ')[1]}`,
        parentKey: null,
        kind: marker.kind,
        number: marker.number,
        heading,
        body: '',
        page: line.page ?? null,
      });
      checkOrder(
        `division-${marker.kind}`,
        division,
        marker.value,
        marker.kind === 'part' ? 'Part' : 'Chapter',
      );
      clause = null;
      bracketParent = null;
      lists = [];
      decimalChain.clear();
      continue;
    }

    let { heading, body } = splitHeading(marker.rest);
    if (!body && !heading) {
      // Number on a line of its own: the next short line (if any) is the heading.
      if (next && !classify(next, line.text) && isShortTitle(next.text)) {
        heading = next.text;
        index += 1;
      }
    } else if (!heading && marker.path && isShortTitle(body) && next) {
      // "2. Objectives" followed by ordinary text, or by its own (a), (b) / 2.1 items: a heading.
      const following = classify(next, line.text);
      const deeper =
        following !== null &&
        (following.path === undefined
          ? following.readings !== undefined
          : following.path.length > marker.path.length);
      if (following === null || deeper) {
        heading = body;
        body = '';
      }
    }

    if (marker.path) {
      const depth = marker.path.length;
      const parentPath = marker.path.slice(0, -1).join('.');
      const parent = depth === 1 ? division : (decimalChain.get(parentPath) ?? null);
      const created = add({
        keyBase: `c-${marker.path.join('-')}`,
        parentKey: parent?.key ?? null,
        kind: depth === 1 ? 'clause' : 'subclause',
        number: marker.number,
        heading,
        body,
        page: line.page ?? null,
      });
      if (depth > 1 && !decimalChain.has(parentPath)) {
        flag(
          created,
          `Clause ${parentPath} was not found, so this item could not be placed under it.`,
        );
      }
      checkOrder(
        depth === 1 ? 'clause' : `decimal-${parentPath}`,
        created,
        marker.value,
        depth === 1 ? 'Clause' : 'Item',
      );
      decimalChain.set(marker.path.join('.'), created);
      for (const key of [...decimalChain.keys()]) {
        if (key.split('.').length > depth) decimalChain.delete(key);
      }
      if (depth === 1) clause = created;
      bracketParent = created;
      lists = [];
      continue;
    }

    // Lettered, roman and numbered list items, nested to any depth.
    const readings = marker.readings ?? [];
    const base = bracketParent ?? clause ?? division;
    let owner: ParsedSection | null;
    let reading: ListReading | undefined;
    let problem: string | null = null;
    let listIndex: number; // where this item's list sits in `lists` afterwards
    const continued = continuing(readings);
    // A new list of the same kind as one already open is a repeated number, not a deeper list.
    const opening = readings.find(
      (candidate) => candidate.value === 1 && !lists.some((list) => list.style === candidate.style),
    );
    if (continued) {
      // The next item of an open list, e.g. (ii) after (i)'s own (a), (b): back out to (i)'s list.
      listIndex = continued.depth;
      reading = continued.reading;
      owner = lists[listIndex]!.owner;
    } else if (opening) {
      // The first item of a new list: it belongs to the item just above it.
      reading = opening;
      owner = lists.length > 0 ? lists[lists.length - 1]!.last : base;
      listIndex = lists.length;
    } else {
      // Neither: place it with the nearest list of the same kind and ask a person to check.
      let depth = -1;
      for (let candidateDepth = lists.length - 1; candidateDepth >= 0; candidateDepth -= 1) {
        const sameKind = readings.find(
          (candidate) => candidate.style === lists[candidateDepth]!.style,
        );
        if (sameKind) {
          depth = candidateDepth;
          reading = sameKind;
          break;
        }
      }
      if (depth >= 0) {
        const list = lists[depth]!;
        listIndex = depth;
        owner = list.owner;
        problem =
          reading!.value === list.value
            ? `The number ${marker.number} appears more than once here.`
            : reading!.value > list.value
              ? `Item ${marker.number} follows ${list.number}. Something in between may be missing or was not recognised.`
              : `Item ${marker.number} comes after ${list.number}, which is out of order.`;
      } else {
        reading = readings[0];
        owner = lists.length > 0 ? lists[lists.length - 1]!.last : base;
        listIndex = lists.length;
        problem = `This list starts at ${marker.number} instead of the first item.`;
      }
    }
    const created = add({
      keyBase: `${owner?.key ?? 'item'}-${marker.number.replace(/[()]/g, '')}`,
      parentKey: owner?.key ?? null,
      kind: 'subclause',
      number: marker.number,
      heading,
      body,
      page: line.page ?? null,
    });
    if (!owner) flag(created, 'This item is not under any numbered clause.');
    if (problem) flag(created, problem);
    lists = lists.slice(0, listIndex);
    lists.push({
      style: reading?.style ?? 'letter',
      value: reading?.value ?? 0,
      number: marker.number,
      owner,
      last: created,
    });
  }

  // Checks on the finished structure.
  const childCount = new Map<string, number>();
  for (const section of sections) {
    if (section.parentKey)
      childCount.set(section.parentKey, (childCount.get(section.parentKey) ?? 0) + 1);
  }
  for (const section of sections) {
    const text = `${section.heading ?? ''} ${section.body}`;
    if (looksGarbled(text)) {
      flag(
        section,
        'Some characters could not be read correctly. Please compare with the original.',
      );
    }
    if (section.body.length > LONG_SECTION) {
      flag(
        section,
        'This section is very long. It may contain several clauses that were not separated.',
      );
    }
    const children = childCount.get(section.key) ?? 0;
    if (!section.body && children === 0 && section.kind !== 'part' && section.kind !== 'chapter') {
      flag(section, 'No text was found under this heading.');
    }
    if (
      (section.kind === 'part' || section.kind === 'chapter') &&
      children === 0 &&
      !section.body
    ) {
      flag(section, `This ${section.kind} has no clauses under it.`);
    }
  }

  if (!anyMarker) {
    issues.push({
      code: 'no_structure',
      severity: 'warning',
      message:
        'No numbered clauses or parts were recognised, so the text is kept as one block. Please divide it into sections during review.',
    });
    for (const section of sections) {
      flag(section, 'The structure of this text could not be recognised automatically.');
    }
  }
  const flagged = sections.filter((section) => section.needsReview).length;
  if (flagged > 0) {
    issues.push({
      code: 'sections_flagged',
      severity: 'warning',
      message: `${flagged} section${flagged === 1 ? '' : 's'} need${flagged === 1 ? 's' : ''} checking by a person before this version can be submitted.`,
    });
  }

  return { title, sections, issues, characterCount };
}
