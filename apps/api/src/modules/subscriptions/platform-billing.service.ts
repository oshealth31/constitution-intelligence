import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  invoices,
  organisations,
  payments,
  plans,
  subscriptionEvents,
  subscriptions,
  users,
  type Database,
} from '@constitution/db';
import {
  containsCardNumber,
  formatMoney,
  type BillingInterval,
  type PaymentMethod,
  type PlanFeature,
} from '@constitution/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { loadAccess, loadUsage } from './access';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type AuditAction = Parameters<AuditService['record']>[0]['action'];

const DAY = 86_400_000;

export interface PlanInput {
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

export interface SubscriptionChange {
  planCode: string;
  status: 'trialing' | 'active';
  billingInterval?: BillingInterval;
  currentPeriodStart?: Date | null;
  currentPeriodEnd: Date | null;
  autoRenew?: boolean;
}

export interface InvoiceInput {
  description: string;
  amountMinor: number;
  dueAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface PaymentInput {
  amountMinor: number;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  notes: string | null;
}

function addInterval(start: Date, interval: 'monthly' | 'annual'): Date {
  const end = new Date(start);
  if (interval === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
}

/**
 * Subscription and billing controls for Platform Super Admins. There is NO payment provider:
 * invoices are issued here, organisations report payments, and a Super Admin verifies each
 * payment against the bank or mobile-money statement before it counts. Every change is written to
 * the organisation's billing history and to the audit log.
 */
@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  // ----- Plans --------------------------------------------------------------------------------

  listPlans() {
    return this.db.select().from(plans).orderBy(desc(plans.active), asc(plans.code));
  }

  async createPlan(code: string, input: PlanInput, actorUserId: string, meta: RequestMeta) {
    const [existing] = await this.db
      .select({ code: plans.code })
      .from(plans)
      .where(eq(plans.code, code));
    if (existing) throw new ConflictException('A plan with this code already exists.');
    const [created] = await this.db
      .insert(plans)
      .values({ code, ...input })
      .returning();
    await this.record('plan.created', actorUserId, null, 'plan', code, meta, { plan: input });
    return created!;
  }

  async updatePlan(code: string, input: PlanInput, actorUserId: string, meta: RequestMeta) {
    const [before] = await this.db.select().from(plans).where(eq(plans.code, code));
    if (!before) throw new NotFoundException('Plan not found.');
    const [updated] = await this.db
      .update(plans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(plans.code, code))
      .returning();
    await this.record('plan.updated', actorUserId, null, 'plan', code, meta, {
      from: before,
      to: input,
    });
    return updated!;
  }

  // ----- One organisation ---------------------------------------------------------------------

  async getBilling(organisationId: string) {
    const [organisation] = await this.db
      .select({
        id: organisations.id,
        name: organisations.name,
        subscriptionId: organisations.currentSubscriptionId,
        deletedAt: organisations.deletedAt,
      })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!organisation) throw new NotFoundException('Organisation not found.');
    const now = new Date();
    const access = await loadAccess(
      this.db,
      organisationId,
      now,
      this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
    );
    const usage = await loadUsage(this.db, organisationId, now);
    const subscription = organisation.subscriptionId
      ? ((
          await this.db
            .select()
            .from(subscriptions)
            .where(
              and(
                eq(subscriptions.id, organisation.subscriptionId),
                eq(subscriptions.organisationId, organisationId),
              ),
            )
        )[0] ?? null)
      : null;
    const invoiceRows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.organisationId, organisationId))
      .orderBy(desc(invoices.issuedAt));
    const paymentRows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.organisationId, organisationId))
      .orderBy(asc(payments.reportedAt));
    const names = await this.names(
      paymentRows.flatMap((payment) => [payment.reportedByUserId, payment.verifiedByUserId]),
    );
    const events = await this.db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.organisationId, organisationId))
      .orderBy(desc(subscriptionEvents.createdAt))
      .limit(100);
    const eventNames = await this.names(events.map((event) => event.actorUserId));
    return {
      organisation: {
        id: organisation.id,
        name: organisation.name,
        deletedAt: organisation.deletedAt?.toISOString() ?? null,
      },
      access,
      usage,
      subscription,
      invoices: invoiceRows.map((invoice) => ({
        ...invoice,
        payments: paymentRows
          .filter((payment) => payment.invoiceId === invoice.id)
          .map((payment) => ({
            ...payment,
            reportedBy: payment.reportedByUserId
              ? (names.get(payment.reportedByUserId) ?? null)
              : null,
            verifiedBy: payment.verifiedByUserId
              ? (names.get(payment.verifiedByUserId) ?? null)
              : null,
          })),
      })),
      events: events.map((event) => ({
        ...event,
        actor: event.actorUserId ? (eventNames.get(event.actorUserId) ?? null) : null,
      })),
    };
  }

  /** Plan, billing interval, dates and renewal. Suspension and cancellation have their own steps. */
  async updateSubscription(
    organisationId: string,
    change: SubscriptionChange,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.assertNotDeleted(organisationId);
    const [plan] = await this.db.select().from(plans).where(eq(plans.code, change.planCode));
    if (!plan) throw new BadRequestException('There is no plan with this code.');
    const now = new Date();
    const before = await this.currentSubscription(organisationId);
    if (!plan.active && before?.planCode !== plan.code) {
      throw new BadRequestException('This plan is no longer offered.');
    }
    const interval: BillingInterval =
      change.billingInterval ??
      (change.status === 'trialing'
        ? 'none'
        : before && before.billingInterval !== 'none'
          ? before.billingInterval
          : 'monthly');
    if (change.status === 'trialing' && interval !== 'none') {
      throw new BadRequestException('A pilot is not billed: its billing interval must be "none".');
    }
    if (change.status === 'active' && interval === 'none' && !plan.isPilot) {
      throw new BadRequestException('Choose monthly or annual billing for a paid plan.');
    }
    const start = change.currentPeriodStart ?? before?.currentPeriodStart ?? now;
    if (change.currentPeriodEnd && change.currentPeriodEnd <= start) {
      throw new BadRequestException('The end date must be after the start date.');
    }
    if (change.currentPeriodEnd && change.currentPeriodEnd <= now) {
      throw new BadRequestException('The period end date must be in the future.');
    }

    const values = {
      planCode: plan.code,
      status: change.status,
      billingInterval: interval,
      currentPeriodStart: start,
      currentPeriodEnd: change.currentPeriodEnd,
      autoRenew: change.autoRenew ?? before?.autoRenew ?? true,
      suspendedAt: null,
      suspensionReason: null,
      cancelledAt: null,
      cancellationReason: null,
      updatedAt: now,
    };
    const subscriptionId = await this.db.transaction(async (tx) => {
      let id = before?.id;
      if (before) {
        if (before.status === 'suspended' || before.status === 'cancelled') {
          throw new ConflictException(
            `This subscription is ${before.status}. Reactivate it first.`,
          );
        }
        await tx.update(subscriptions).set(values).where(eq(subscriptions.id, before.id));
      } else {
        const [created] = await tx
          .insert(subscriptions)
          .values({ organisationId, ...values })
          .returning({ id: subscriptions.id });
        id = created!.id;
        await tx
          .update(organisations)
          .set({ currentSubscriptionId: id, updatedAt: now })
          .where(eq(organisations.id, organisationId));
      }
      await this.event(
        tx,
        organisationId,
        id!,
        'subscription_updated',
        describeSubscription(plan.name, values),
        actorUserId,
        {
          from: before
            ? {
                planCode: before.planCode,
                status: before.status,
                billingInterval: before.billingInterval,
                currentPeriodEnd: before.currentPeriodEnd,
                autoRenew: before.autoRenew,
              }
            : null,
          to: { ...values, updatedAt: undefined },
        },
      );
      return id!;
    });
    await this.record(
      'subscription.updated',
      actorUserId,
      organisationId,
      'subscription',
      subscriptionId,
      meta,
      {
        from: before
          ? {
              planCode: before.planCode,
              status: before.status,
              currentPeriodEnd: before.currentPeriodEnd,
            }
          : null,
        to: {
          planCode: values.planCode,
          status: values.status,
          billingInterval: values.billingInterval,
          currentPeriodEnd: values.currentPeriodEnd,
          autoRenew: values.autoRenew,
        },
        by: 'platform',
        paymentProvider: 'none (manual)',
      },
    );
  }

  async suspend(organisationId: string, reason: string, actorUserId: string, meta: RequestMeta) {
    await this.assertNotDeleted(organisationId);
    const current = await this.requireSubscription(organisationId);
    if (current.status === 'suspended') throw new ConflictException('Already suspended.');
    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status: 'suspended',
          suspendedAt: new Date(),
          suspensionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, current.id));
      await this.event(
        tx,
        organisationId,
        current.id,
        'suspended',
        `Suspended: ${reason}`,
        actorUserId,
        {
          previousStatus: current.status,
        },
      );
    });
    await this.record(
      'subscription.suspended',
      actorUserId,
      organisationId,
      'subscription',
      current.id,
      meta,
      {
        reason,
        previousStatus: current.status,
      },
    );
  }

  /** Suspended or cancelled → back to a pilot (for unbilled subscriptions) or active. */
  async reactivate(organisationId: string, reason: string, actorUserId: string, meta: RequestMeta) {
    await this.assertNotDeleted(organisationId);
    const current = await this.requireSubscription(organisationId);
    if (current.status !== 'suspended' && current.status !== 'cancelled') {
      throw new ConflictException('Only a suspended or cancelled subscription can be reactivated.');
    }
    const status = current.billingInterval === 'none' ? 'trialing' : 'active';
    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status,
          suspendedAt: null,
          suspensionReason: null,
          cancelledAt: null,
          cancellationReason: null,
          autoRenew: current.status === 'cancelled' ? true : current.autoRenew,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, current.id));
      await this.event(
        tx,
        organisationId,
        current.id,
        'reactivated',
        `Reactivated: ${reason}`,
        actorUserId,
        {
          previousStatus: current.status,
        },
      );
    });
    await this.record(
      'subscription.reactivated',
      actorUserId,
      organisationId,
      'subscription',
      current.id,
      meta,
      {
        reason,
        previousStatus: current.status,
      },
    );
  }

  /** At the end of the period (access continues until then, plus grace) or straight away. */
  async cancel(
    organisationId: string,
    reason: string,
    when: 'period_end' | 'now',
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.assertNotDeleted(organisationId);
    const current = await this.requireSubscription(organisationId);
    if (current.status === 'cancelled') throw new ConflictException('Already cancelled.');
    const now = new Date();
    // "Now" ends the period this moment (the start is moved back if it was only just set).
    const start =
      when === 'now' && current.currentPeriodStart.getTime() >= now.getTime()
        ? new Date(now.getTime() - 1000)
        : current.currentPeriodStart;
    const end = when === 'now' ? now : current.currentPeriodEnd;
    await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: reason,
          autoRenew: false,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, current.id));
      await this.event(
        tx,
        organisationId,
        current.id,
        'cancelled',
        when === 'now'
          ? `Cancelled with immediate effect: ${reason}`
          : `Cancelled at the end of the period: ${reason}`,
        actorUserId,
        { when, previousStatus: current.status, periodEnd: end },
      );
    });
    await this.record(
      'subscription.cancelled',
      actorUserId,
      organisationId,
      'subscription',
      current.id,
      meta,
      {
        reason,
        when,
      },
    );
  }

  /**
   * Starts the next period (one month or one year) and, when the plan has a price for that
   * interval, issues the invoice for it. A renewal after the grace period has run out starts today.
   */
  async renew(organisationId: string, actorUserId: string, meta: RequestMeta) {
    await this.assertNotDeleted(organisationId);
    const current = await this.requireSubscription(organisationId);
    if (current.status === 'suspended' || current.status === 'cancelled') {
      throw new ConflictException(`This subscription is ${current.status}. Reactivate it first.`);
    }
    if (current.billingInterval === 'none') {
      throw new ConflictException(
        'A pilot is not renewed. Move the organisation to a paid plan instead.',
      );
    }
    const [plan] = await this.db.select().from(plans).where(eq(plans.code, current.planCode));
    const now = new Date();
    const previousEnd = current.currentPeriodEnd ?? now;
    const lapsedTooLong = previousEnd.getTime() + (plan?.graceDays ?? 0) * DAY < now.getTime();
    const start = lapsedTooLong ? now : previousEnd;
    const end = addInterval(start, current.billingInterval);
    const price =
      current.billingInterval === 'monthly' ? plan?.monthlyPriceMinor : plan?.annualPriceMinor;

    const invoiceNumber = await this.db.transaction(async (tx) => {
      await tx
        .update(subscriptions)
        .set({ status: 'active', currentPeriodStart: start, currentPeriodEnd: end, updatedAt: now })
        .where(eq(subscriptions.id, current.id));
      let number: string | null = null;
      if (price && price > 0) {
        number = await this.insertInvoice(
          tx,
          organisationId,
          current.id,
          actorUserId,
          {
            description: `${plan!.name} plan, ${current.billingInterval === 'monthly' ? 'monthly' : 'annual'} subscription`,
            amountMinor: price,
            dueAt: new Date(Math.max(start.getTime(), now.getTime())),
            periodStart: start,
            periodEnd: end,
          },
          plan!.currency,
        );
      }
      await this.event(
        tx,
        organisationId,
        current.id,
        'renewed',
        `Renewed until ${end.toISOString().slice(0, 10)}${number ? `; invoice ${number} issued` : '; no price is set for this plan, so no invoice was issued'}.`,
        actorUserId,
        { start, end, invoiceNumber: number },
      );
      return number;
    });
    await this.record(
      'subscription.renewed',
      actorUserId,
      organisationId,
      'subscription',
      current.id,
      meta,
      {
        periodStart: start,
        periodEnd: end,
        invoiceNumber,
      },
    );
  }

  // ----- Invoices and payments ----------------------------------------------------------------

  async issueInvoice(
    organisationId: string,
    input: InvoiceInput,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.assertNotDeleted(organisationId);
    const current = await this.requireSubscription(organisationId);
    const [plan] = await this.db.select().from(plans).where(eq(plans.code, current.planCode));
    const number = await this.db.transaction(async (tx) =>
      this.insertInvoice(
        tx,
        organisationId,
        current.id,
        actorUserId,
        input,
        plan?.currency ?? 'BWP',
      ),
    );
    await this.record('invoice.issued', actorUserId, organisationId, 'invoice', number, meta, {
      amountMinor: input.amountMinor,
      dueAt: input.dueAt,
    });
    return number;
  }

  async voidInvoice(
    organisationId: string,
    invoiceId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.db.transaction(async (tx) => {
      const invoice = await this.lockInvoice(tx, organisationId, invoiceId);
      if (invoice.status !== 'open')
        throw new ConflictException(`This invoice is already ${invoice.status}.`);
      const [verified] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, 'verified')));
      if (verified) {
        throw new ConflictException(
          'A verified payment exists for this invoice, so it cannot be voided.',
        );
      }
      await tx
        .update(invoices)
        .set({ status: 'void', voidedAt: new Date(), voidReason: reason })
        .where(eq(invoices.id, invoiceId));
      await this.event(
        tx,
        organisationId,
        invoice.subscriptionId,
        'invoice_voided',
        `Invoice ${invoice.number} voided: ${reason}`,
        actorUserId,
        {},
      );
    });
    await this.record('invoice.voided', actorUserId, organisationId, 'invoice', invoiceId, meta, {
      reason,
    });
  }

  /** A Super Admin records a payment they were told about (for example by phone). Still needs verifying. */
  async recordPayment(
    organisationId: string,
    invoiceId: string,
    input: PaymentInput,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    refuseCardNumbers(input.reference, input.notes);
    const paymentId = await this.db.transaction(async (tx) => {
      const invoice = await this.lockInvoice(tx, organisationId, invoiceId);
      if (invoice.status !== 'open')
        throw new ConflictException(`This invoice is ${invoice.status}.`);
      const [created] = await tx
        .insert(payments)
        .values({
          organisationId,
          invoiceId,
          amountMinor: input.amountMinor,
          currency: invoice.currency,
          method: input.method,
          reference: input.reference,
          paidOn: input.paidOn,
          notes: input.notes,
          reportedByUserId: actorUserId,
        })
        .returning({ id: payments.id });
      await this.event(
        tx,
        organisationId,
        invoice.subscriptionId,
        'payment_recorded',
        `Payment of ${formatMoney(input.amountMinor, invoice.currency)} recorded for invoice ${invoice.number}, waiting for verification.`,
        actorUserId,
        {},
      );
      return created!.id;
    });
    await this.record('payment.reported', actorUserId, organisationId, 'payment', paymentId, meta, {
      invoiceId,
      amountMinor: input.amountMinor,
      method: input.method,
      by: 'platform',
    });
  }

  /**
   * MANUAL VERIFICATION: the Super Admin confirms they have seen the money arrive (bank or
   * mobile-money statement). Only then does the payment count, a receipt number is given, and the
   * invoice is marked paid once verified payments cover it.
   */
  async verifyPayment(
    organisationId: string,
    paymentId: string,
    note: string | null,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const result = await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.organisationId, organisationId)))
        .for('update');
      if (!payment) throw new NotFoundException('Payment not found.');
      if (payment.status !== 'pending_verification') {
        throw new ConflictException(`This payment is already ${payment.status.replace('_', ' ')}.`);
      }
      const invoice = await this.lockInvoice(tx, organisationId, payment.invoiceId);
      if (invoice.status === 'void') throw new ConflictException('The invoice has been voided.');
      const now = new Date();
      const receiptRow = (
        await tx.execute(
          sql`SELECT 'RCP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('receipt_number_seq')::text, 4, '0') AS receipt`,
        )
      ).rows[0] as { receipt: string };
      const receipt = receiptRow.receipt;
      await tx
        .update(payments)
        .set({
          status: 'verified',
          verifiedByUserId: actorUserId,
          verifiedAt: now,
          verificationNote: note,
          receiptNumber: receipt,
        })
        .where(eq(payments.id, paymentId));
      const totalRow = (
        await tx.execute(sql`SELECT coalesce(sum(amount_minor), 0)::int AS total FROM payments
                             WHERE invoice_id = ${invoice.id} AND status = 'verified'`)
      ).rows[0] as { total: number };
      const total = totalRow.total;
      const paid = Number(total) >= invoice.amountMinor;
      if (paid && invoice.status === 'open') {
        await tx
          .update(invoices)
          .set({ status: 'paid', paidAt: now })
          .where(eq(invoices.id, invoice.id));
      }
      await this.event(
        tx,
        organisationId,
        invoice.subscriptionId,
        'payment_verified',
        `Payment of ${formatMoney(payment.amountMinor, payment.currency)} verified by hand; receipt ${receipt}.${paid ? ` Invoice ${invoice.number} is paid.` : ` Invoice ${invoice.number} is not yet fully paid.`}`,
        actorUserId,
        { receipt, invoicePaid: paid },
      );
      return { receipt, invoicePaid: paid, ownReport: payment.reportedByUserId === actorUserId };
    });
    await this.record('payment.verified', actorUserId, organisationId, 'payment', paymentId, meta, {
      ...result,
      method: 'manual verification (no payment provider)',
    });
    return result;
  }

  async rejectPayment(
    organisationId: string,
    paymentId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.organisationId, organisationId)))
        .for('update');
      if (!payment) throw new NotFoundException('Payment not found.');
      if (payment.status !== 'pending_verification') {
        throw new ConflictException(`This payment is already ${payment.status.replace('_', ' ')}.`);
      }
      await tx
        .update(payments)
        .set({ status: 'rejected', rejectionReason: reason })
        .where(eq(payments.id, paymentId));
      const invoice = await this.lockInvoice(tx, organisationId, payment.invoiceId);
      await this.event(
        tx,
        organisationId,
        invoice.subscriptionId,
        'payment_rejected',
        `Reported payment for invoice ${invoice.number} could not be verified: ${reason}`,
        actorUserId,
        {},
      );
    });
    await this.record('payment.rejected', actorUserId, organisationId, 'payment', paymentId, meta, {
      reason,
    });
  }

  // ----- Across organisations ------------------------------------------------------------------

  /** What needs a Super Admin's attention. */
  async attention() {
    const now = new Date();
    const pending = (
      await this.db.execute(sql`
        SELECT p.id, p.organisation_id AS "organisationId", o.name AS "organisationName",
               i.number AS "invoiceNumber", p.amount_minor AS "amountMinor", p.currency,
               p.method, p.reference, p.paid_on AS "paidOn", p.reported_at AS "reportedAt"
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id AND i.organisation_id = p.organisation_id
        JOIN organisations o ON o.id = p.organisation_id
        WHERE p.status = 'pending_verification'
        ORDER BY p.reported_at`)
    ).rows;
    const overdue = (
      await this.db.execute(sql`
        SELECT i.id, i.organisation_id AS "organisationId", o.name AS "organisationName", i.number,
               i.amount_minor AS "amountMinor", i.currency, i.due_at AS "dueAt"
        FROM invoices i JOIN organisations o ON o.id = i.organisation_id
        WHERE i.status = 'open' AND i.due_at < ${now}
        ORDER BY i.due_at`)
    ).rows;
    const renewals = (
      await this.db.execute(sql`
        SELECT o.id AS "organisationId", o.name AS "organisationName", s.plan_code AS "planCode",
               s.status, s.current_period_end AS "currentPeriodEnd", s.auto_renew AS "autoRenew"
        FROM organisations o
        JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE s.status IN ('trialing', 'active', 'past_due', 'cancelled')
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end < ${new Date(now.getTime() + 14 * DAY)}
        ORDER BY s.current_period_end`)
    ).rows;
    const all = (
      await this.db.execute(
        sql`SELECT id, name FROM organisations WHERE status <> 'archived' ORDER BY name`,
      )
    ).rows as { id: string; name: string }[];
    const restricted: {
      organisationId: string;
      organisationName: string;
      state: string;
      restrictedSince: string | null;
      dataRetainedUntil: string | null;
      retentionPassed: boolean;
    }[] = [];
    for (const organisation of all) {
      const access = await loadAccess(
        this.db,
        organisation.id,
        now,
        this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
      );
      if (
        access.state === 'restricted' ||
        access.state === 'suspended' ||
        access.state === 'none'
      ) {
        restricted.push({
          organisationId: organisation.id,
          organisationName: organisation.name,
          state: access.state,
          restrictedSince: access.restrictedSince,
          dataRetainedUntil: access.dataRetainedUntil,
          retentionPassed:
            access.dataRetainedUntil !== null && new Date(access.dataRetainedUntil) < now,
        });
      }
    }
    return {
      pendingPayments: pending,
      overdueInvoices: overdue,
      renewalsDue: renewals,
      restricted,
    };
  }

  // ----- Helpers ------------------------------------------------------------------------------

  private async currentSubscription(organisationId: string) {
    const [organisation] = await this.db
      .select({ subscriptionId: organisations.currentSubscriptionId })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!organisation) throw new NotFoundException('Organisation not found.');
    if (!organisation.subscriptionId) return null;
    const [subscription] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, organisation.subscriptionId),
          eq(subscriptions.organisationId, organisationId),
        ),
      );
    return subscription ?? null;
  }

  /**
   * A deleted organisation (Task D3) keeps its financial records: its invoices can still be
   * settled or voided, but its subscription cannot be changed, renewed or re-invoiced.
   */
  private async assertNotDeleted(organisationId: string) {
    const [organisation] = await this.db
      .select({ deletedAt: organisations.deletedAt })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (organisation?.deletedAt) {
      throw new ConflictException(
        'This organisation’s data has been deleted and its subscription has ended. Existing invoices can still be settled or voided.',
      );
    }
  }

  private async requireSubscription(organisationId: string) {
    const subscription = await this.currentSubscription(organisationId);
    if (!subscription) throw new ConflictException('This organisation has no subscription yet.');
    return subscription;
  }

  private async lockInvoice(tx: Tx, organisationId: string, invoiceId: string) {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.organisationId, organisationId)))
      .for('update');
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  private async insertInvoice(
    tx: Tx,
    organisationId: string,
    subscriptionId: string,
    actorUserId: string,
    input: InvoiceInput,
    currency: string,
  ): Promise<string> {
    const numberRow = (
      await tx.execute(
        sql`SELECT 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0') AS number`,
      )
    ).rows[0] as { number: string };
    const number = numberRow.number;
    await tx.insert(invoices).values({
      organisationId,
      subscriptionId,
      number,
      description: input.description,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      amountMinor: input.amountMinor,
      currency,
      dueAt: input.dueAt,
      createdByUserId: actorUserId,
    });
    await this.event(
      tx,
      organisationId,
      subscriptionId,
      'invoice_issued',
      `Invoice ${number} issued for ${formatMoney(input.amountMinor, currency)}, due ${input.dueAt.toISOString().slice(0, 10)}.`,
      actorUserId,
      {},
    );
    return number;
  }

  private async event(
    tx: Tx,
    organisationId: string,
    subscriptionId: string,
    kind: string,
    summary: string,
    actorUserId: string,
    detail: Record<string, unknown>,
  ) {
    await tx.insert(subscriptionEvents).values({
      organisationId,
      subscriptionId,
      kind,
      summary: summary.slice(0, 500),
      detail: JSON.parse(JSON.stringify(detail)) as Record<string, unknown>,
      actorUserId,
    });
  }

  private async names(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map<string, string>();
    const rows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, wanted));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private record(
    action: AuditAction,
    actorUserId: string,
    organisationId: string | null,
    targetType: string,
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType,
      targetId,
      metadata,
      meta,
    });
  }
}

function describeSubscription(
  planName: string,
  values: {
    status: string;
    billingInterval: string;
    currentPeriodEnd: Date | null;
    autoRenew: boolean;
  },
): string {
  const kind = values.status === 'trialing' ? 'Pilot' : 'Active';
  const until = values.currentPeriodEnd
    ? ` until ${values.currentPeriodEnd.toISOString().slice(0, 10)}`
    : '';
  const billing =
    values.billingInterval === 'none' ? 'not billed' : `billed ${values.billingInterval}`;
  return `${kind} on the ${planName} plan${until}, ${billing}${values.billingInterval === 'none' ? '' : values.autoRenew ? ', renews' : ', does not renew'}.`;
}

function refuseCardNumbers(...texts: (string | null)[]) {
  if (texts.some((text) => text && containsCardNumber(text))) {
    throw new BadRequestException(
      'This looks like a payment card number. Card details must never be entered or stored.',
    );
  }
}
