import type { VersionReview } from './portal';

/**
 * The step-by-step guide on a version's page: from upload to publishing it to members.
 * Pure logic (no React) so it can be unit-tested; the page draws it with a progress bar.
 */

export type GuideStepKey = 'upload' | 'check' | 'send' | 'approve' | 'publish';
export type GuideStepState = 'done' | 'current' | 'todo';

export interface GuideStep {
  key: GuideStepKey;
  label: string;
  state: GuideStepState;
}

/** Where the "show me" button on the guide takes the person. */
export type GuideTarget = 'next-section' | 'approval' | 'documents' | null;

export interface PublishGuide {
  steps: GuideStep[];
  /** 0–100, including part of the checking step. */
  percent: number;
  /** Number of the current step, 1-based (steps.length + 1 once everything is done). */
  stepNumber: number;
  title: string;
  text: string;
  /** Sections marked "Check this", and how many of them are checked. */
  checks: { total: number; done: number };
  target: GuideTarget;
  targetLabel: string | null;
  /** True when this person must wait for someone else. */
  waiting: boolean;
}

const LABELS: Record<GuideStepKey, string> = {
  upload: 'Upload',
  check: 'Check the text',
  send: 'Send for approval',
  approve: 'Approval',
  publish: 'Publish to members',
};
const ORDER: GuideStepKey[] = ['upload', 'check', 'send', 'approve', 'publish'];

/** Index of the current step for a status (0-based), or null for superseded/archived. */
function currentIndex(version: Pick<VersionReview, 'status' | 'sectionsNeedingReview'>) {
  switch (version.status) {
    case 'draft':
      return version.sectionsNeedingReview > 0 ? 1 : 2;
    case 'in_review':
      return 3;
    case 'approved':
      return 4;
    case 'published':
      return 5;
    default:
      return null;
  }
}

/** Null for versions that are kept only for the record (superseded or archived). */
export function publishGuide(
  version: Pick<VersionReview, 'status' | 'sectionsNeedingReview' | 'sections' | 'extraction'>,
  rights: { canEdit: boolean; canApprove: boolean },
): PublishGuide | null {
  const index = currentIndex(version);
  if (index === null) return null;

  const flagged = version.sections.filter((s) => s.needsReview || s.reviewedAt);
  const checks = {
    total: flagged.length,
    done: flagged.filter((s) => !s.needsReview).length,
  };
  const steps = ORDER.map((key, i) => ({
    key,
    label: LABELS[key],
    state: (i < index ? 'done' : i === index ? 'current' : 'todo') as GuideStepState,
  }));
  // Part of the checking step counts while sections are being checked.
  const partial = index === 1 && checks.total > 0 ? checks.done / checks.total : 0;
  const percent = Math.round(((index + partial) / ORDER.length) * 100);

  const base = { steps, percent, stepNumber: index + 1, checks };

  if (version.extraction.status === 'failed') {
    return {
      ...base,
      title: 'Upload a readable copy',
      text: 'The text of this file could not be read, so it cannot be published. Go back to Documents and upload the constitution again, for example as a Word document or a PDF made from Word (not a scan).',
      target: 'documents',
      targetLabel: 'Back to Documents',
      waiting: !rights.canEdit,
    };
  }

  switch (index) {
    case 1: {
      const left = checks.total - checks.done;
      return {
        ...base,
        title: `Check the marked sections (${checks.done} of ${checks.total} done)`,
        text: rights.canEdit
          ? `${left} section${left === 1 ? ' is' : 's are'} marked “Check this”. Compare each with the original document, correct it if needed (Edit), then press “Mark as checked”.`
          : `${left} section${left === 1 ? ' is' : 's are'} still to be checked by an editor.`,
        target: rights.canEdit ? 'next-section' : null,
        targetLabel: rights.canEdit ? 'Go to the next section to check' : null,
        waiting: !rights.canEdit,
      };
    }
    case 2:
      return {
        ...base,
        title: 'Read through, then send it for approval',
        text: rights.canEdit
          ? 'Scroll through the text and compare it with the original. When it matches, tick “I have compared this text…” in the Approval box and press “Send for approval”.'
          : 'An editor is checking the text and will send it for approval.',
        target: rights.canEdit ? 'approval' : null,
        targetLabel: rights.canEdit ? 'Go to the Approval box' : null,
        waiting: !rights.canEdit,
      };
    case 3:
      return {
        ...base,
        title: rights.canApprove ? 'Approve it, or send it back' : 'Waiting for approval',
        text: rights.canApprove
          ? 'Read the text once more. In the Approval box, press “Approve”, or write what needs to change and send it back.'
          : 'An organisation administrator must approve it. Nothing more to do for now.',
        target: rights.canApprove ? 'approval' : null,
        targetLabel: rights.canApprove ? 'Go to the Approval box' : null,
        waiting: !rights.canApprove,
      };
    case 4:
      return {
        ...base,
        title: rights.canApprove ? 'Last step: publish it to members' : 'Waiting to be published',
        text: rights.canApprove
          ? 'In the Approval box, tick “Yes, make this the current constitution” and press “Make current”. Members will then see it.'
          : 'An organisation administrator can now publish it to members.',
        target: rights.canApprove ? 'approval' : null,
        targetLabel: rights.canApprove ? 'Go to the Approval box' : null,
        waiting: !rights.canApprove,
      };
    default:
      return {
        ...base,
        stepNumber: ORDER.length + 1,
        title: 'Done: members can read it',
        text: 'This is the current constitution. To change it later, upload a new version on the Documents page.',
        target: null,
        targetLabel: null,
        waiting: false,
      };
  }
}

/** The steps shown on the Documents page, before anything is uploaded. */
export const PUBLISH_STEPS_HELP: { label: string; text: string }[] = [
  { label: LABELS.upload, text: 'Choose the Word (.docx) or PDF file and press Upload.' },
  {
    label: LABELS.check,
    text: 'Open the new version. Fix and “Mark as checked” every section marked “Check this”.',
  },
  { label: LABELS.send, text: 'Confirm the text matches the original and send it.' },
  { label: LABELS.approve, text: 'An administrator approves it (or sends it back).' },
  { label: LABELS.publish, text: 'An administrator presses “Make current”. Members see it.' },
];
