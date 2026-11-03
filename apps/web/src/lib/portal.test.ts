import { describe, expect, it } from 'vitest';
import {
  buildSectionTree,
  canManage,
  documentProblem,
  eventLabel,
  extractionLabel,
  workflowStep,
  contentsEntries,
  portalPath,
  sectionTitle,
  splitHighlights,
  type Section,
} from './portal';

const section = (overrides: Partial<Section> & Pick<Section, 'id' | 'position'>): Section => ({
  parentSectionId: null,
  kind: 'clause',
  refKey: overrides.id,
  number: null,
  heading: null,
  body: '',
  ...overrides,
});

describe('search highlights', () => {
  it('splits marked matches into highlighted text parts', () => {
    expect(splitHighlights('The [[quorum]] is one third of [[members]].')).toEqual([
      { text: 'The ', highlight: false },
      { text: 'quorum', highlight: true },
      { text: ' is one third of ', highlight: false },
      { text: 'members', highlight: true },
      { text: '.', highlight: false },
    ]);
  });

  it('keeps HTML in a snippet as plain text', () => {
    const parts = splitHighlights('<img src=x onerror=alert(1)> [[quorum]]');
    expect(parts[0]).toEqual({ text: '<img src=x onerror=alert(1)> ', highlight: false });
  });

  it('handles snippets without matches', () => {
    expect(splitHighlights('plain')).toEqual([{ text: 'plain', highlight: false }]);
    expect(splitHighlights('')).toEqual([]);
  });
});

describe('sections', () => {
  const sections = [
    section({ id: 'p1', kind: 'part', number: 'Part 1', heading: 'General', position: 0 }),
    section({ id: 'c1', parentSectionId: 'p1', number: '1', heading: 'Name', position: 1 }),
    section({ id: 'c2', parentSectionId: 'p1', number: '2', heading: 'Objectives', position: 2 }),
    section({ id: 'a', parentSectionId: 'c2', kind: 'subclause', number: '(a)', position: 3 }),
    section({ id: 'loose', number: '3', heading: 'Other', position: 4 }),
  ];

  it('builds parts, clauses and sub-clauses in reading order', () => {
    const tree = buildSectionTree([...sections].reverse());
    expect(tree.map((node) => node.id)).toEqual(['p1', 'loose']);
    expect(tree[0]!.children.map((node) => node.id)).toEqual(['c1', 'c2']);
    expect(tree[0]!.children[1]!.children[0]).toMatchObject({ id: 'a', depth: 2 });
  });

  it('lists contents without sub-clauses', () => {
    expect(contentsEntries(buildSectionTree(sections)).map((node) => node.id)).toEqual([
      'p1',
      'c1',
      'c2',
      'loose',
    ]);
  });

  it('writes clear section titles', () => {
    expect(sectionTitle({ kind: 'part', number: 'Part 1', heading: 'General' })).toBe(
      'Part 1 · General',
    );
    expect(sectionTitle({ kind: 'clause', number: '7', heading: 'Quorum' })).toBe('7. Quorum');
    expect(sectionTitle({ kind: 'subclause', number: '(a)', heading: null })).toBe('(a)');
    expect(sectionTitle({ kind: 'clause', number: null, heading: null })).toBe('Untitled section');
  });
});

describe('portal helpers', () => {
  it('shows the manage area only to people with a management permission', () => {
    expect(canManage(['organisation.read', 'constitution.read'])).toBe(false);
    expect(canManage(['organisation.read', 'content.review'])).toBe(true);
    expect(canManage(undefined)).toBe(false);
  });

  it('builds portal addresses', () => {
    expect(portalPath('sample-netball-club', '/search')).toBe('/o/sample-netball-club/search');
  });
});

describe('document management helpers', () => {
  it('checks the chosen file before uploading', () => {
    expect(documentProblem({ name: 'Constitution.PDF', size: 1000 })).toBeNull();
    expect(documentProblem({ name: 'c.docx', size: 1000 })).toBeNull();
    expect(documentProblem({ name: 'c.doc', size: 1000 })).toMatch(/PDF/);
    expect(documentProblem({ name: 'c.pdf', size: 0 })).toMatch(/empty/);
    expect(documentProblem({ name: 'c.pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
  });

  it('describes workflow steps in plain words', () => {
    expect(workflowStep('draft')).toBe(0);
    expect(workflowStep('published')).toBe(3);
    expect(workflowStep('archived')).toBe(-1);
    expect(eventLabel('changes_requested')).toBe('Sent back for changes');
    expect(extractionLabel('not_started')).toBe('No file uploaded');
    expect(extractionLabel('needs_review')).toBe('Needs checking');
  });
});
