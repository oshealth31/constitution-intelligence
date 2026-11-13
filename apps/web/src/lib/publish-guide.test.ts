import { describe, expect, it } from 'vitest';
import { publishGuide } from './publish-guide';
import type { ReviewSection, VersionReview } from './portal';

type GuideInput = Parameters<typeof publishGuide>[0];

const section = (id: string, needsReview: boolean, reviewedAt: string | null = null) =>
  ({ id, needsReview, reviewedAt }) as unknown as ReviewSection;

const version = (overrides: Partial<VersionReview> = {}): GuideInput => ({
  status: 'draft',
  sectionsNeedingReview: 0,
  sections: [],
  extraction: { status: 'succeeded', issues: [], meta: {} },
  ...overrides,
});

const editor = { canEdit: true, canApprove: false };
const admin = { canEdit: true, canApprove: true };
const member = { canEdit: false, canApprove: false };

const states = (guide: ReturnType<typeof publishGuide>) =>
  guide?.steps.map((step) => `${step.key}:${step.state}`);

describe('publishGuide', () => {
  it('starts at checking while sections are marked, with partial progress', () => {
    const guide = publishGuide(
      version({
        sectionsNeedingReview: 3,
        sections: [
          section('a', true),
          section('b', true),
          section('c', true),
          section('d', false, '2026-11-13T10:00:00Z'),
          section('e', false),
        ],
      }),
      editor,
    );
    expect(states(guide)).toEqual([
      'upload:done',
      'check:current',
      'send:todo',
      'approve:todo',
      'publish:todo',
    ]);
    expect(guide?.checks).toEqual({ total: 4, done: 1 });
    expect(guide?.percent).toBe(25); // (1 + 1/4) / 5
    expect(guide?.title).toContain('1 of 4');
    expect(guide?.target).toBe('next-section');
  });

  it('moves to sending once every marked section is checked', () => {
    const guide = publishGuide(version({ sections: [section('a', false, 'x')] }), editor);
    expect(guide?.stepNumber).toBe(3);
    expect(guide?.percent).toBe(40);
    expect(guide?.target).toBe('approval');
  });

  it('tells people without the right what they are waiting for', () => {
    expect(publishGuide(version({ status: 'in_review' }), editor)).toMatchObject({
      title: 'Waiting for approval',
      waiting: true,
      target: null,
    });
    expect(publishGuide(version({ status: 'approved' }), editor)?.waiting).toBe(true);
    expect(publishGuide(version({ sectionsNeedingReview: 1 }), member)?.target).toBeNull();
  });

  it('guides an administrator through approval and publishing', () => {
    const review = publishGuide(version({ status: 'in_review' }), admin);
    expect(review).toMatchObject({ stepNumber: 4, percent: 60, target: 'approval' });
    const publish = publishGuide(version({ status: 'approved' }), admin);
    expect(publish).toMatchObject({ stepNumber: 5, percent: 80, target: 'approval' });
    expect(publish?.title).toContain('publish');
  });

  it('is complete once published', () => {
    const guide = publishGuide(version({ status: 'published' }), admin);
    expect(guide?.percent).toBe(100);
    expect(guide?.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('asks for a readable copy when the text could not be read', () => {
    const guide = publishGuide(
      version({ extraction: { status: 'failed', issues: [], meta: {} } }),
      editor,
    );
    expect(guide).toMatchObject({ title: 'Upload a readable copy', target: 'documents' });
  });

  it('shows nothing for versions kept only for the record', () => {
    expect(publishGuide(version({ status: 'superseded' }), admin)).toBeNull();
    expect(publishGuide(version({ status: 'archived' }), admin)).toBeNull();
  });
});
