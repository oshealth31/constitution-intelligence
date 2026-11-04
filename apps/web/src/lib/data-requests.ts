// Types and labels for personal data requests (Task D11), shared by the Control Centre pages.

export type DataRequestKind = 'copy' | 'correction' | 'deletion';

export interface DataRequestRow {
  id: string;
  kind: DataRequestKind;
  status: 'open' | 'completed' | 'cancelled';
  subjectEmail: string;
  hasAccount: boolean;
  receivedOn: string;
  respondBy: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  overdue: boolean;
  createdBy: string | null;
}

export interface DataRequestDetail {
  request: {
    id: string;
    kind: DataRequestKind;
    status: 'open' | 'completed' | 'cancelled';
    subjectEmail: string;
    receivedOn: string;
    respondBy: string;
    receivedVia: string;
    identityCheck: string;
    details: string | null;
    createdAt: string;
    createdBy: string | null;
    completedAt: string | null;
    completedBy: string | null;
    outcome: Record<string, unknown> | null;
    cancelledAt: string | null;
    cancelReason: string | null;
  };
  subject: {
    hasAccount: boolean;
    displayName: string | null;
    status: string | null;
    isSuperAdmin: boolean;
    organisations: { id: string; name: string; role: string; status: string }[];
    deletionBlockers: string[];
  };
}

export const KIND_LABELS: Record<DataRequestKind, string> = {
  copy: 'Copy of their data',
  correction: 'Correction',
  deletion: 'Deletion',
};

export const OUTCOME_LABELS: Record<string, string> = {
  memberships: 'Memberships removed',
  signIns: 'Sign-ins removed',
  aiConversations: 'AI conversations deleted',
  aiFeedback: 'AI feedback deleted',
  invitations: 'Invitations deleted',
  auditEntriesAnonymised: 'Audit entries anonymised',
  corrected: 'Corrected',
  reason: 'Reason',
  note: 'Note',
};
