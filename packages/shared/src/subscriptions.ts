/**
 * Subscriptions and entitlements: the names shared by the API (which enforces them) and the web
 * app (which only uses them for labels and for deciding what to show).
 */

/** Optional features a plan can include. Reading, search and "find relevant clauses" are always included. */
export const PLAN_FEATURES = [
  'ai_answers',
  'approved_answers',
  'simple_words',
  'custom_branding',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const FEATURE_LABELS: Readonly<Record<PlanFeature, string>> = {
  ai_answers: 'AI answers to questions',
  approved_answers: 'Approved answers (common questions)',
  simple_words: 'Simple words for clauses',
  custom_branding: 'Custom branding (logo, colours, welcome message)',
};

/** Usage limits. A missing (null) limit means "no limit". */
export const PLAN_LIMITS = [
  'members',
  'constitutions',
  'aiQuestionsPerMonth',
  'storageMb',
] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

export const LIMIT_LABELS: Readonly<Record<PlanLimit, string>> = {
  members: 'Members (including invitations not yet accepted)',
  constitutions: 'Documents (constitutions)',
  aiQuestionsPerMonth: 'AI questions per month',
  storageMb: 'File storage (MB)',
};

export const BILLING_INTERVALS = ['monthly', 'annual', 'none'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * What an organisation can do right now, worked out from its subscription, its plan, its invoices
 * and today's date:
 *  - pilot / active: everything the plan includes;
 *  - grace: the period ended or an invoice is overdue, but the grace period has not run out yet
 *    (everything still works, with a warning);
 *  - restricted: the grace period has run out. Owners and administrators can still READ (to see
 *    billing and their documents); everyone else is blocked and nothing can be changed;
 *  - suspended: suspended by Constitution Intelligence. Only the billing page and the portal
 *    home page (with a notice) are available;
 *  - none: no subscription at all (treated like suspended).
 */
export const ACCESS_STATES = [
  'pilot',
  'active',
  'grace',
  'restricted',
  'suspended',
  'none',
] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

export const ACCESS_STATE_LABELS: Readonly<Record<AccessState, string>> = {
  pilot: 'Pilot',
  active: 'Active',
  grace: 'Grace period',
  restricted: 'Restricted (payment or renewal needed)',
  suspended: 'Suspended',
  none: 'No subscription',
};

export const PAYMENT_STATUSES = [
  'not_required',
  'paid',
  'awaiting_payment',
  'awaiting_verification',
  'overdue',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  not_required: 'No payment due',
  paid: 'Paid',
  awaiting_payment: 'Invoice waiting for payment',
  awaiting_verification: 'Payment reported, waiting for verification',
  overdue: 'Overdue',
};

/** How a payment was made. There is no card option: card details are never taken or stored. */
export const PAYMENT_METHODS = ['bank_transfer', 'mobile_money', 'cash', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  bank_transfer: 'Bank transfer (EFT)',
  mobile_money: 'Mobile money',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
};

/** Error reasons the API attaches to refusals caused by the subscription. */
export const SUBSCRIPTION_REFUSALS = [
  'SUBSCRIPTION_INACTIVE',
  'SUBSCRIPTION_READ_ONLY',
  'FEATURE_NOT_IN_PLAN',
  'PLAN_LIMIT_REACHED',
] as const;
export type SubscriptionRefusal = (typeof SUBSCRIPTION_REFUSALS)[number];

/** "BWP 1,250.00" from an amount in the smallest unit (thebe for pula). */
export function formatMoney(amountMinor: number, currency = 'BWP'): string {
  const major = amountMinor / 100;
  return `${currency} ${major.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * True when the text contains something that looks like a payment card number (13–19 digits,
 * possibly with spaces or dashes, passing the Luhn check). Used to refuse such text: card
 * details must never be typed into or stored by Constitution Intelligence.
 */
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
