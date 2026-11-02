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
}

export interface SectionNode extends Section {
  depth: number;
  children: SectionNode[];
}

export interface SearchMatch {
  sectionId: string;
  versionId: string;
  constitutionId: string;
  constitutionTitle: string;
  refKey: string;
  number: string | null;
  heading: string | null;
  snippet: string;
  rank: number;
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

/**
 * Splits a search snippet into plain and highlighted parts. The API marks matches as
 * [[like this]]; everything is returned as text for React to display safely (never as HTML).
 */
export function splitHighlights(snippet: string): { text: string; highlight: boolean }[] {
  const parts: { text: string; highlight: boolean }[] = [];
  const pattern = /\[\[(.*?)\]\]/g;
  let last = 0;
  for (let match = pattern.exec(snippet); match; match = pattern.exec(snippet)) {
    if (match.index > last) parts.push({ text: snippet.slice(last, match.index), highlight: false });
    if (match[1]) parts.push({ text: match[1], highlight: true });
    last = match.index + match[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), highlight: false });
  return parts;
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
