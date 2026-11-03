/**
 * Organisation portal: response types and small helpers.
 * The API decides who may see what; `can()` here only decides which buttons to show.
 */
import type { BrandColours } from './branding';

export interface PublicPortal {
  slug: string;
  name: string;
  tagline: string | null;
  colours: BrandColours;
  logoUrl: string | null;
  available: boolean;
}

export interface LibraryItem {
  id: string;
  title: string;
  published: {
    versionId: string;
    label: string;
    versionNumber: number;
    publishedAt: string | null;
    sectionCount: number;
  } | null;
  versionsInProgress?: number;
}

export interface PortalHome {
  organisation: {
    id: string;
    slug: string;
    name: string;
    legalName: string;
    tagline: string | null;
    welcomeMessage: string | null;
    colours: BrandColours;
    logoUrl: string | null;
  };
  you: { role: string; roleLabel: string; permissions: string[] };
  library: { constitutions: number; published: number; firstPublished: LibraryItem | null };
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  label: string;
  status: string;
  publishedAt: string | null;
  /** Whether the original uploaded document is available to download. */
  hasOriginal?: boolean;
}

export interface ConstitutionDetail {
  id: string;
  title: string;
  versions: VersionSummary[];
}

export interface Section {
  id: string;
  parentSectionId: string | null;
  kind: 'part' | 'chapter' | 'section' | 'clause' | 'subclause';
  refKey: string;
  number: string | null;
  heading: string | null;
  body: string;
  position: number;
  /** Worked out by the server from stored numbers, e.g. "7(a)" / "Clause 7(a)". */
  reference?: string | null;
  referenceLabel?: string | null;
  /** Page of the original document this section starts on, when known. */
  sourcePage?: number | null;
}

export interface SectionNode extends Section {
  depth: number;
  children: SectionNode[];
}

/** One search result: stored wording and numbers only, with references worked out from them. */
export interface SearchResult {
  sectionId: string;
  refKey: string;
  kind: Section['kind'];
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  path: { refKey: string; number: string | null; heading: string | null }[];
  /** An exact slice of the original wording; "…" marks left-out text. */
  excerpt: string;
  matchedBy: 'reference' | 'title' | 'text';
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface SearchResponse {
  query: string;
  interpretedAs: { type: 'clause' | 'part' | 'chapter'; display: string } | null;
  terms: string[];
  results: SearchResult[];
  suggestions: string[];
}

export interface ContentStatusConstitution {
  id: string;
  title: string;
  versions: {
    id: string;
    versionNumber: number;
    label: string;
    status: string;
    publishedAt: string | null;
    updatedAt: string;
    sectionCount: number;
    extractionStatus: string;
    sectionsNeedingReview: number;
    fileName: string | null;
    latestDecision: {
      decision: 'approved' | 'changes_requested';
      comment: string | null;
      reviewerName: string | null;
      createdAt: string;
    } | null;
  }[];
}

export interface BrandingSettings {
  organisationName: string;
  slug: string;
  displayName: string | null;
  tagline: string | null;
  welcomeMessage: string | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  accentColour: string | null;
  logoFileId: string | null;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

/** Display-only permission check (the API enforces the real rules). */
export function can(permissions: readonly string[] | undefined, permission: string): boolean {
  return permissions?.includes(permission) ?? false;
}

/** Whether to show the "Manage" area at all. */
export function canManage(permissions: readonly string[] | undefined): boolean {
  return ['branding.manage', 'members.read', 'content.review', 'organisation.settings.manage'].some(
    (permission) => can(permissions, permission),
  );
}

export function portalPath(slug: string, path = ''): string {
  return `/o/${encodeURIComponent(slug)}${path}`;
}

/** The address of one section inside the reading view. */
export function sectionAnchor(refKey: string): string {
  return `section-${refKey}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits text into plain and highlighted parts for the given search terms (matched at the start
 * of words, ignoring case). The text itself is never changed; React shows every part as text.
 */
export function highlightTerms(
  text: string,
  terms: readonly string[],
): { text: string; highlight: boolean }[] {
  const usable = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (usable.length === 0 || text.length === 0) return text ? [{ text, highlight: false }] : [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${usable.join('|')})`, 'giu');
  const parts: { text: string; highlight: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), highlight: false });
    parts.push({ text: match[0], highlight: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), highlight: false });
  return parts;
}

/** The same words a search used, taken from the query (operators and very common words left out). */
export function queryTerms(query: string): string[] {
  const ignored = new Set(['or', 'and', 'the', 'of', 'a', 'an', 'to', 'in']);
  const words = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return [...new Set(words.filter((word) => !ignored.has(word)))].slice(0, 10);
}

/** A citation people can copy: "Constitution of X, Registered constitution (version 1), Clause 7(a)". */
export function citation(
  constitutionTitle: string,
  version: { label: string; versionNumber: number },
  section: Pick<Section, 'kind' | 'number' | 'heading' | 'referenceLabel'>,
): string {
  const where = section.referenceLabel ?? sectionTitle(section);
  return `${constitutionTitle}, ${version.label} (version ${version.versionNumber}), ${where}`;
}

/** Arranges sections (already in reading order) into parts, clauses and sub-clauses. */
export function buildSectionTree(sections: readonly Section[]): SectionNode[] {
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  const nodes = new Map<string, SectionNode>();
  for (const section of ordered) {
    nodes.set(section.id, { ...section, depth: 0, children: [] });
  }
  const roots: SectionNode[] = [];
  for (const section of ordered) {
    const node = nodes.get(section.id)!;
    const parent = section.parentSectionId ? nodes.get(section.parentSectionId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: SectionNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** "Part 1 · Name and objectives", "7. Quorum", "(a)". */
export function sectionTitle(section: Pick<Section, 'kind' | 'number' | 'heading'>): string {
  const number = section.number?.trim();
  const heading = section.heading?.trim();
  if (number && heading) {
    return section.kind === 'part' || section.kind === 'chapter'
      ? `${number} · ${heading}`
      : `${/^\d+$/.test(number) ? `${number}.` : number} ${heading}`;
  }
  return heading || number || 'Untitled section';
}

/** Entries for the "Contents" list: parts, chapters, sections and clauses (not sub-clauses). */
export function contentsEntries(tree: readonly SectionNode[]): SectionNode[] {
  const entries: SectionNode[] = [];
  const walk = (list: readonly SectionNode[]) => {
    for (const node of list) {
      if (node.kind !== 'subclause') entries.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return entries;
}

/** Reads a browser file as base64 (without the "data:...;base64," prefix). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const LOGO_MAX_BYTES = 512 * 1024;

// ----- Document management (Stage 7) --------------------------------------------------------

export const DOCUMENT_ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export interface VersionEvent {
  id: string;
  event: string;
  comment: string | null;
  at: string;
  by: string | null;
}

export interface ExtractionIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  refKey?: string;
  page?: number;
}

export interface ReviewSection extends Section {
  needsReview: boolean;
  reviewReason: string | null;
  sourcePage: number | null;
  editedAt: string | null;
  reviewedAt: string | null;
}

export interface VersionReview {
  id: string;
  constitution: { id: string; title: string } | null;
  versionNumber: number;
  label: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  extraction: {
    status: 'not_started' | 'succeeded' | 'needs_review' | 'failed';
    issues: ExtractionIssue[];
    meta: {
      format?: 'pdf' | 'docx';
      pageCount?: number | null;
      characterCount?: number;
      sectionCount?: number;
      flaggedCount?: number;
      detectedTitle?: string | null;
    };
  };
  source: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
    uploadedBy: string | null;
  } | null;
  sections: ReviewSection[];
  sectionsNeedingReview: number;
  history: VersionEvent[];
  editable: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  submitted: 'Sent for approval',
  approved: 'Approved',
  changes_requested: 'Sent back for changes',
  published: 'Made the current version',
  superseded: 'Replaced by a newer version',
  archived: 'Archived',
};

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/_/g, ' ');
}

const EXTRACTION_LABELS: Record<string, string> = {
  // Only versions created without an uploaded file (for example sample data) have this status.
  not_started: 'No file uploaded',
  succeeded: 'Text read',
  needs_review: 'Needs checking',
  failed: 'Could not be read',
};

export function extractionLabel(status: string): string {
  return EXTRACTION_LABELS[status] ?? status;
}

/** The four main steps every version goes through, in order. */
export const WORKFLOW_STEPS = [
  { status: 'draft', label: 'Draft: check the text' },
  { status: 'in_review', label: 'Waiting for approval' },
  { status: 'approved', label: 'Approved' },
  { status: 'published', label: 'Current version' },
] as const;

/** Index of the version's step in WORKFLOW_STEPS, or -1 for superseded/archived. */
export function workflowStep(status: string): number {
  return WORKFLOW_STEPS.findIndex((step) => step.status === status);
}

export function documentProblem(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
    return 'Please choose a PDF (.pdf) or Word (.docx) document.';
  }
  if (file.size === 0) return 'The file is empty.';
  if (file.size > DOCUMENT_MAX_BYTES) return 'The file is larger than 10 MB.';
  return null;
}

// ----- AI questions (Stage 9) -----------------------------------------------------------------

export interface AiStatus {
  available: boolean;
  mode: string;
  disclaimer: string;
  unsupportedMessage: string;
  /** The no-AI "find relevant clauses" mode is available. */
  clauseFinder?: boolean;
}

/** A clause found by "find relevant clauses": the original wording, exactly as stored. */
export interface ClauseMatch {
  sectionId: string;
  refKey: string;
  kind: Section['kind'];
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  text: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface ClauseFinderResponse {
  question: string;
  terms: string[];
  results: ClauseMatch[];
  message: string | null;
  notice: string;
}

export interface AnswerCitation {
  sectionId: string;
  refKey: string;
  kind: Section['kind'];
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  /** Exact words from the original text. */
  quote: string;
  /** The whole original text of the section, exactly as stored. */
  sourceText: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface AnswerResponse {
  messageId: string;
  conversationId: string;
  question: string;
  status: 'answered' | 'insufficient' | 'unavailable';
  explanation: string | null;
  message: string | null;
  citations: AnswerCitation[];
  disclaimer: string;
  mode: string;
}

/** Splits the original text around the quoted words, so the quote can be marked in place. */
export function locateQuote(
  text: string,
  quote: string,
): { before: string; quote: string; after: string } | null {
  const index = text.indexOf(quote);
  if (index === -1 || quote.length === 0) return null;
  return { before: text.slice(0, index), quote, after: text.slice(index + quote.length) };
}

// ----- Approved answers -----------------------------------------------------------------------

/** A clause an approved answer relies on, with its original wording exactly as stored. */
export interface LinkedClause {
  sectionId: string;
  refKey: string;
  kind: Section['kind'];
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  text: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
  versionStatus?: string;
  published?: boolean;
}

export interface AnswerIssue {
  code: 'no_clauses' | 'clause_not_published' | 'unknown_reference' | 'number_not_in_clauses';
  blocking: boolean;
  message: string;
}

export type ManagedAnswerStatus = 'draft' | 'approved' | 'needs_review' | 'retired';

export interface ManagedAnswer {
  id: string;
  question: string;
  answer: string;
  status: ManagedAnswerStatus;
  source: 'manual' | 'import' | 'ai';
  reviewReason: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clauses: LinkedClause[];
  issues: AnswerIssue[];
  readyToApprove: boolean;
}

export interface MemberAnswer {
  id: string;
  question: string;
  answer: string;
  approvedAt: string | null;
  clauses: LinkedClause[];
}

export interface MemberAnswers {
  disclaimer: string;
  answers: MemberAnswer[];
}

export const ANSWER_STATUS: Record<
  ManagedAnswerStatus,
  { label: string; help: string; tone: 'good' | 'warning' | 'neutral' | 'info' }
> = {
  draft: { label: 'Draft', help: 'Members cannot see it until it is approved.', tone: 'info' },
  approved: { label: 'Approved', help: 'Members can see it.', tone: 'good' },
  needs_review: {
    label: 'Needs review',
    help: 'The constitution changed. Hidden from members until it is checked and approved again.',
    tone: 'warning',
  },
  retired: { label: 'Retired', help: 'No longer shown to members.', tone: 'neutral' },
};

export function answerSourceLabel(answer: Pick<ManagedAnswer, 'source' | 'createdBy'>): string {
  if (answer.source === 'ai') return 'Drafted by AI – check every word against the original';
  if (answer.source === 'import') return 'Imported from a file – check against the original';
  return `Written by ${answer.createdBy ?? 'a former member'}`;
}

/** Clause references typed as "7, 7(a); Part 2" → ["7", "7(a)", "Part 2"]. */
export function splitClauseReferences(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export interface AnswerImportRow {
  question: string;
  answer: string;
  clauses: string[];
  draftedBy?: 'ai' | 'person';
}

/**
 * Reads an import file: JSON, either `{ "answers": [ ... ] }` or a list. Each item needs a
 * question, an answer and its clauses (a list, or text like "7, 7(a)"). The server checks
 * everything again.
 */
export function parseAnswerImport(text: string): { rows: AnswerImportRow[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'The file is not valid JSON. See the example format below.' };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { answers?: unknown }).answers)
      ? (data as { answers: unknown[] }).answers
      : null;
  if (!list) return { error: 'The file must contain a list of answers.' };
  if (list.length === 0) return { error: 'The file has no answers.' };
  const rows: AnswerImportRow[] = [];
  for (const [index, item] of list.entries()) {
    const record = (item ?? {}) as Record<string, unknown>;
    const clauses = Array.isArray(record.clauses)
      ? record.clauses.map(String)
      : typeof record.clauses === 'string'
        ? splitClauseReferences(record.clauses)
        : [];
    if (typeof record.question !== 'string' || typeof record.answer !== 'string') {
      return { error: `Answer ${index + 1} needs a "question" and an "answer".` };
    }
    if (clauses.length === 0) {
      return { error: `Answer ${index + 1} needs at least one clause in "clauses".` };
    }
    rows.push({
      question: record.question,
      answer: record.answer,
      clauses,
      ...(record.draftedBy === 'ai' || record.draftedBy === 'person'
        ? { draftedBy: record.draftedBy }
        : {}),
    });
  }
  return { rows };
}
