/**
 * Subscription and billing types shared by the organisation's billing page and the control
 * centre. The API decides everything; these are only for showing it.
 */

// Labels kept in step with packages/shared/src/subscriptions.ts (which the API uses).
export type AccessState = 'pilot' | 'active' | 'grace' | 'restricted' | 'suspended' | 'none';
export type PaymentStatus =
  'not_required' | 'paid' | 'awaiting_payment' | 'awaiting_verification' | 'overdue';
export type PlanFeature = 'ai_answers' | 'approved_answers' | 'simple_words' | 'custom_branding';
export type PlanLimit = 'members' | 'constitutions' | 'aiQuestionsPerMonth' | 'storageMb';
export type PaymentMethod = 'bank_transfer' | 'mobile_money' | 'cash' | 'cheque' | 'other';

export const PLAN_FEATURES: PlanFeature[] = [
  'ai_answers',
  'approved_answers',
  'simple_words',
  'custom_branding',
];
export const FEATURE_LABELS: Record<PlanFeature, string> = {
  ai_answers: 'AI answers to questions',
  approved_answers: 'Approved answers (common questions)',
  simple_words: 'Simple words for clauses',
  custom_branding: 'Custom branding (logo, colours, welcome message)',
};
export const PLAN_LIMITS: PlanLimit[] = [
  'members',
  'constitutions',
  'aiQuestionsPerMonth',
  'storageMb',
];
export const LIMIT_LABELS: Record<PlanLimit, string> = {
  members: 'Members (including invitations not yet accepted)',
  constitutions: 'Documents (constitutions)',
  aiQuestionsPerMonth: 'AI questions this month',
  storageMb: 'File storage (MB)',
};
export const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  pilot: 'Pilot',
  active: 'Active',
  grace: 'Grace period',
  restricted: 'Restricted (payment or renewal needed)',
  suspended: 'Suspended',
  none: 'No subscription',
};
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_required: 'No payment due',
  paid: 'Paid',
  awaiting_payment: 'Invoice waiting for payment',
  awaiting_verification: 'Payment reported, waiting for verification',
  overdue: 'Overdue',
};
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer (EFT)',
  mobile_money: 'Mobile money',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
};
export const PAYMENT_RECORD_LABELS: Record<PaymentRecord['status'], string> = {
  pending_verification: 'Waiting for verification',
  verified: 'Verified',
  rejected: 'Not verified',
};

export function formatMoney(amountMinor: number, currency = 'BWP'): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Same check as the API: 13–19 digits passing the Luhn check look like a card number. */
export function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let index = 0; index < digits.length; index += 1) {
      let digit = Number(digits[digits.length - 1 - index]);
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export interface SubscriptionAccess {
  state: AccessState;
  fullAccess: boolean;
  readOnly: boolean;
  message: string;
  paymentStatus: PaymentStatus;
  planCode: string | null;
  planName: string | null;
  features: PlanFeature[];
  limits: Record<PlanLimit, number | null>;
  periodEnd: string | null;
  renewal: 'renews' | 'ends' | 'not_applicable';
  lapsedAt: string | null;
  graceEndsAt: string | null;
  restrictedSince: string | null;
  dataRetainedUntil: string | null;
}

export interface PaymentRecord {
  id: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  status: 'pending_verification' | 'verified' | 'rejected';
  reportedBy: string | null;
  reportedAt: string;
  verifiedAt: string | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
  rejectionReason: string | null;
  receiptNumber: string | null;
  notes?: string | null;
}

export interface InvoiceRecord {
  id: string;
  number: string;
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
  amountMinor: number;
  currency: string;
  status: 'open' | 'paid' | 'void';
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  voidReason: string | null;
  balanceMinor?: number;
  payments: PaymentRecord[];
}

export interface BillingEvent {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  actor?: string | null;
}

export interface OrganisationBilling {
  access: SubscriptionAccess;
  subscription: {
    planName: string;
    planDescription: string | null;
    status: string;
    billingInterval: 'monthly' | 'annual' | 'none';
    currentPeriodStart: string;
    currentPeriodEnd: string | null;
    autoRenew: boolean;
    currency: string;
    monthlyPriceMinor: number | null;
    annualPriceMinor: number | null;
    graceDays: number;
    isPilot: boolean;
  } | null;
  usage: Record<PlanLimit, number>;
  invoices: InvoiceRecord[];
  events: BillingEvent[];
  manualPayments: { notice: string; instructions: string };
  retention: { days: number; policy: string[] };
}

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  isPilot: boolean;
  active: boolean;
  currency: string;
  monthlyPriceMinor: number | null;
  annualPriceMinor: number | null;
  graceDays: number;
  features: PlanFeature[];
  maxMembers: number | null;
  maxConstitutions: number | null;
  maxAiQuestionsPerMonth: number | null;
  maxStorageMb: number | null;
}

export interface PlatformBilling {
  organisation: { id: string; name: string };
  access: SubscriptionAccess;
  usage: Record<PlanLimit, number>;
  subscription: {
    id: string;
    planCode: string;
    status: string;
    billingInterval: 'monthly' | 'annual' | 'none';
    currentPeriodStart: string;
    currentPeriodEnd: string | null;
    autoRenew: boolean;
    suspensionReason: string | null;
    cancellationReason: string | null;
  } | null;
  invoices: InvoiceRecord[];
  events: BillingEvent[];
}

export const ACCESS_TONE: Record<AccessState, 'good' | 'info' | 'warning' | 'critical'> = {
  pilot: 'info',
  active: 'good',
  grace: 'warning',
  restricted: 'critical',
  suspended: 'critical',
  none: 'critical',
};

/** "250.00" → 25000 (thebe). Returns null for anything that is not a sensible amount. */
export function parseAmount(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Thebe → "250.00" for an input field. */
export function amountText(minor: number | null): string {
  return minor === null ? '' : (minor / 100).toFixed(2);
}
