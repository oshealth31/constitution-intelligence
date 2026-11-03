/**
 * What an organisation may do right now. Worked out on EVERY request from its subscription, its
 * plan, its invoices and the current date — there is no background job that could fall behind,
 * and nothing in the browser decides it.
 *
 * The rules (see docs/subscriptions.md):
 *  1. Suspended by Constitution Intelligence, or no subscription → "suspended" / "none".
 *  2. The subscription "lapses" at the earliest of:
 *       - the end of the current period (when one is set and has passed),
 *       - the due date of the oldest unpaid invoice (when it has passed),
 *       - the cancellation time, for a subscription cancelled with no period end.
 *  3. After lapsing there are `grace_days` (from the plan) of full access → "grace".
 *  4. After the grace period → "restricted": owners and administrators may still READ; nobody
 *     can change anything; other roles cannot use the portal. Data is kept for the retention
 *     period (SUBSCRIPTION_DATA_RETENTION_DAYS) from that moment.
 *  5. Otherwise → "pilot" (status "trialing") or "active".
 */
import {
  PLAN_FEATURES,
  type AccessState,
  type PaymentStatus,
  type PlanFeature,
  type PlanLimit,
} from '@constitution/shared';
import { sql, type SQL } from 'drizzle-orm';

const DAY = 86_400_000;

export interface PlanFacts {
  code: string;
  name: string;
  isPilot: boolean;
  graceDays: number;
  features: readonly string[];
  limits: Record<PlanLimit, number | null>;
}

export interface SubscriptionFacts {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  billingInterval: 'monthly' | 'annual' | 'none';
  autoRenew: boolean;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
}

export interface InvoiceFacts {
  status: 'open' | 'paid' | 'void';
  dueAt: Date;
  hasPendingPayment: boolean;
}

export interface Access {
  state: AccessState;
  /** Everything the plan includes may be used. */
  fullAccess: boolean;
  /** Restricted: owners and administrators may read, nothing may change. */
  readOnly: boolean;
  /** A sentence for people using the portal. */
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

const NO_LIMITS: Record<PlanLimit, number | null> = {
  members: null,
  constitutions: null,
  aiQuestionsPerMonth: null,
  storageMb: null,
};

function day(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Gaborone',
  });
}

function paymentStatusOf(invoices: readonly InvoiceFacts[], now: Date): PaymentStatus {
  const open = invoices.filter((invoice) => invoice.status === 'open');
  if (open.some((invoice) => invoice.dueAt <= now && !invoice.hasPendingPayment)) return 'overdue';
  if (open.some((invoice) => invoice.hasPendingPayment)) return 'awaiting_verification';
  if (open.length > 0) return 'awaiting_payment';
  return invoices.some((invoice) => invoice.status === 'paid') ? 'paid' : 'not_required';
}

export function computeAccess(input: {
  subscription: SubscriptionFacts | null;
  plan: PlanFacts | null;
  invoices: readonly InvoiceFacts[];
  now: Date;
  retentionDays: number;
}): Access {
  const { subscription, plan, invoices, now } = input;
  const base = {
    fullAccess: false,
    readOnly: false,
    paymentStatus: paymentStatusOf(invoices, now),
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
    features: (plan?.features ?? []).filter((feature): feature is PlanFeature =>
      (PLAN_FEATURES as readonly string[]).includes(feature),
    ),
    limits: plan?.limits ?? NO_LIMITS,
    periodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    renewal: (!subscription || subscription.billingInterval === 'none'
      ? 'not_applicable'
      : subscription.autoRenew && subscription.status !== 'cancelled'
        ? 'renews'
        : 'ends') as Access['renewal'],
    lapsedAt: null,
    graceEndsAt: null,
    restrictedSince: null,
    dataRetainedUntil: null,
  };

  if (!subscription || !plan) {
    return {
      ...base,
      state: 'none',
      message:
        'This organisation does not have a subscription. Please contact Constitution Intelligence.',
    };
  }
  if (subscription.status === 'suspended') {
    return {
      ...base,
      state: 'suspended',
      message:
        'This organisation’s subscription is suspended. Please contact your organisation’s owner or Constitution Intelligence.',
    };
  }

  const lapses: Date[] = [];
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
    lapses.push(subscription.currentPeriodEnd);
  }
  for (const invoice of invoices) {
    // A reported payment waiting for verification does not stop the clock: until someone has
    // checked that the money arrived, the invoice is unpaid.
    if (invoice.status === 'open' && invoice.dueAt <= now) lapses.push(invoice.dueAt);
  }
  if (subscription.status === 'cancelled' && !subscription.currentPeriodEnd && subscription.cancelledAt) {
    lapses.push(subscription.cancelledAt);
  }

  if (lapses.length === 0) {
    const pilot = subscription.status === 'trialing';
    return {
      ...base,
      state: pilot ? 'pilot' : 'active',
      fullAccess: true,
      message: pilot
        ? subscription.currentPeriodEnd
          ? `Pilot subscription until ${day(subscription.currentPeriodEnd)}.`
          : 'Pilot subscription.'
        : subscription.status === 'cancelled' && subscription.currentPeriodEnd
          ? `The subscription has been cancelled and ends on ${day(subscription.currentPeriodEnd)}.`
          : 'The subscription is active.',
    };
  }

  const lapsedAt = new Date(Math.min(...lapses.map((date) => date.getTime())));
  const graceEndsAt = new Date(lapsedAt.getTime() + plan.graceDays * DAY);
  if (now < graceEndsAt) {
    return {
      ...base,
      state: 'grace',
      fullAccess: true,
      lapsedAt: lapsedAt.toISOString(),
      graceEndsAt: graceEndsAt.toISOString(),
      message: `Payment or renewal is needed by ${day(graceEndsAt)}. Until then everything keeps working.`,
    };
  }
  const retainedUntil = new Date(graceEndsAt.getTime() + input.retentionDays * DAY);
  return {
    ...base,
    state: 'restricted',
    readOnly: true,
    lapsedAt: lapsedAt.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    restrictedSince: graceEndsAt.toISOString(),
    dataRetainedUntil: retainedUntil.toISOString(),
    message: `The subscription needs renewal or payment. Until then members cannot use the portal, and owners and administrators can only read. Your data is kept until at least ${day(retainedUntil)}.`,
  };
}

/** Something with `execute`: the main database or a tenant transaction. */
interface Executor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

interface Row {
  subscriptionId: string | null;
  status: SubscriptionFacts['status'] | null;
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  billingInterval: SubscriptionFacts['billingInterval'] | null;
  autoRenew: boolean | null;
  suspendedAt: Date | string | null;
  cancelledAt: Date | string | null;
  planCode: string | null;
  planName: string | null;
  isPilot: boolean | null;
  graceDays: number | null;
  features: string[] | string | null;
  maxMembers: number | null;
  maxConstitutions: number | null;
  maxAiQuestionsPerMonth: number | null;
  maxStorageMb: number | null;
}

const toDate = (value: Date | string | null) => (value === null ? null : new Date(value));

function parseArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
}

/** Loads the facts for one organisation and works out its access. */
export async function loadAccess(
  executor: Executor,
  organisationId: string,
  now: Date,
  retentionDays: number,
): Promise<Access> {
  const [row] = (
    await executor.execute(sql`
      SELECT s.id AS "subscriptionId", s.status, s.current_period_start AS "currentPeriodStart",
             s.current_period_end AS "currentPeriodEnd", s.billing_interval AS "billingInterval",
             s.auto_renew AS "autoRenew", s.suspended_at AS "suspendedAt",
             s.cancelled_at AS "cancelledAt",
             p.code AS "planCode", p.name AS "planName", p.is_pilot AS "isPilot",
             p.grace_days AS "graceDays", p.features, p.max_members AS "maxMembers",
             p.max_constitutions AS "maxConstitutions",
             p.max_ai_questions_per_month AS "maxAiQuestionsPerMonth",
             p.max_storage_mb AS "maxStorageMb"
      FROM organisations o
      LEFT JOIN subscriptions s
        ON s.id = o.current_subscription_id AND s.organisation_id = o.id
      LEFT JOIN plans p ON p.code = s.plan_code
      WHERE o.id = ${organisationId}`)
  ).rows as Row[];
  if (!row || !row.subscriptionId || !row.planCode) {
    return computeAccess({ subscription: null, plan: null, invoices: [], now, retentionDays });
  }
  const invoiceRows = (
    await executor.execute(sql`
      SELECT i.status, i.due_at AS "dueAt",
             EXISTS (SELECT 1 FROM payments p
                     WHERE p.invoice_id = i.id AND p.organisation_id = i.organisation_id
                       AND p.status = 'pending_verification') AS "hasPendingPayment"
      FROM invoices i
      WHERE i.organisation_id = ${organisationId} AND i.subscription_id = ${row.subscriptionId}
        AND i.status <> 'void'`)
  ).rows as { status: InvoiceFacts['status']; dueAt: Date | string; hasPendingPayment: boolean }[];
  return computeAccess({
    subscription: {
      id: row.subscriptionId,
      status: row.status!,
      currentPeriodStart: toDate(row.currentPeriodStart)!,
      currentPeriodEnd: toDate(row.currentPeriodEnd),
      billingInterval: row.billingInterval!,
      autoRenew: row.autoRenew ?? false,
      suspendedAt: toDate(row.suspendedAt),
      cancelledAt: toDate(row.cancelledAt),
    },
    plan: {
      code: row.planCode,
      name: row.planName ?? row.planCode,
      isPilot: row.isPilot ?? false,
      graceDays: row.graceDays ?? 0,
      features: parseArray(row.features),
      limits: {
        members: row.maxMembers,
        constitutions: row.maxConstitutions,
        aiQuestionsPerMonth: row.maxAiQuestionsPerMonth,
        storageMb: row.maxStorageMb,
      },
    },
    invoices: invoiceRows.map((invoice) => ({
      status: invoice.status,
      dueAt: new Date(invoice.dueAt),
      hasPendingPayment: Boolean(invoice.hasPendingPayment),
    })),
    now,
    retentionDays,
  });
}

/** Current usage, for the limits. AI questions count from the start of the month (UTC). */
export async function loadUsage(
  executor: Executor,
  organisationId: string,
  now: Date,
): Promise<Record<PlanLimit, number>> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = (
    await executor.execute(sql`
      SELECT
        (SELECT count(*) FROM memberships m WHERE m.organisation_id = ${organisationId}
           AND m.status = 'active')::int
        + (SELECT count(*) FROM invitations i WHERE i.organisation_id = ${organisationId}
           AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ${now})::int
          AS members,
        (SELECT count(*) FROM constitutions c WHERE c.organisation_id = ${organisationId})::int
          AS constitutions,
        (SELECT coalesce(sum(u.quantity), 0) FROM usage_records u
           WHERE u.organisation_id = ${organisationId} AND u.metric = 'ai.questions'
             AND u.occurred_at >= ${monthStart})::int AS "aiQuestionsPerMonth",
        (SELECT coalesce(sum(f.size_bytes), 0) FROM files f
           WHERE f.organisation_id = ${organisationId})::bigint AS "storageBytes"`)
  ).rows as {
    members: number;
    constitutions: number;
    aiQuestionsPerMonth: number;
    storageBytes: string | number;
  }[];
  return {
    members: Number(row?.members ?? 0),
    constitutions: Number(row?.constitutions ?? 0),
    aiQuestionsPerMonth: Number(row?.aiQuestionsPerMonth ?? 0),
    storageMb: Math.ceil(Number(row?.storageBytes ?? 0) / (1024 * 1024)),
  };
}
