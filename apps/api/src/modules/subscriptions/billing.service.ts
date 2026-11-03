import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { invoices, payments, subscriptionEvents, users } from '@constitution/db';
import { containsCardNumber, type PaymentMethod } from '@constitution/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { loadAccess, loadUsage } from './access';

export const MANUAL_PAYMENT_NOTICE =
  'Payments are checked by hand: there is no online card payment. After you pay, report the payment here with its reference. Constitution Intelligence checks that the money has arrived and then marks the invoice as paid and issues a receipt.';

export const RETENTION_POLICY = [
  'While the subscription is active, in a pilot, or in its grace period, everything works as normal.',
  'When the grace period runs out, access is restricted: members cannot use the portal, and owners and administrators can only read. Nothing is deleted.',
  'Data is kept unchanged for the retention period after access becomes restricted, so the organisation can renew, or ask for a copy of its documents.',
  'After the retention period, Constitution Intelligence reviews the organisation for deletion and contacts the owner first. Nothing is deleted automatically.',
  'Invoices, payments and receipts are kept as financial records even if the rest of the data is deleted.',
];

export interface PaymentReport {
  amountMinor: number;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  notes: string | null;
}

/** An organisation's own view of its subscription and billing. Runs under Row-Level Security. */
@Injectable()
export class BillingService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  overview(scope: TenantScope) {
    return this.tenantDb.run(scope, async (tx) => {
      const now = new Date();
      const access = await loadAccess(
        tx,
        scope.organisationId,
        now,
        this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
      );
      const usage = await loadUsage(tx, scope.organisationId, now);
      const [subscription] = (
        await tx.execute(sql`
          SELECT s.id, s.plan_code AS "planCode", s.status, s.billing_interval AS "billingInterval",
                 s.current_period_start AS "currentPeriodStart",
                 s.current_period_end AS "currentPeriodEnd", s.auto_renew AS "autoRenew",
                 s.suspended_at AS "suspendedAt", s.cancelled_at AS "cancelledAt",
                 p.name AS "planName", p.description AS "planDescription", p.currency,
                 p.monthly_price_minor AS "monthlyPriceMinor",
                 p.annual_price_minor AS "annualPriceMinor", p.grace_days AS "graceDays",
                 p.is_pilot AS "isPilot"
          FROM organisations o
          JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
          JOIN plans p ON p.code = s.plan_code
          WHERE o.id = ${scope.organisationId}`)
      ).rows as Record<string, unknown>[];
      const history = await this.history(tx, scope);
      const events = await tx
        .select({
          id: subscriptionEvents.id,
          kind: subscriptionEvents.kind,
          summary: subscriptionEvents.summary,
          createdAt: subscriptionEvents.createdAt,
        })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.organisationId, scope.organisationId))
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(50);
      return {
        access,
        subscription: subscription ?? null,
        usage,
        invoices: history,
        events,
        manualPayments: {
          notice: MANUAL_PAYMENT_NOTICE,
          instructions:
            this.config.BILLING_PAYMENT_INSTRUCTIONS ??
            'Constitution Intelligence will send you payment details with each invoice.',
        },
        retention: {
          days: this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
          policy: RETENTION_POLICY,
        },
      };
    });
  }

  /**
   * An Owner says an invoice was paid (bank transfer, mobile money ...). This does NOT mark the
   * invoice as paid: a Platform Super Admin must verify it first.
   */
  async reportPayment(
    scope: TenantScope,
    invoiceId: string,
    report: PaymentReport,
    meta: RequestMeta,
  ) {
    if (containsCardNumber(report.reference) || containsCardNumber(report.notes ?? '')) {
      throw new BadRequestException(
        'This looks like a payment card number. Never enter card details here — only the reference of your bank transfer or mobile-money payment.',
      );
    }
    const today = new Date();
    const paidOn = new Date(`${report.paidOn}T00:00:00Z`);
    if (paidOn.getTime() > today.getTime() + 86_400_000) {
      throw new BadRequestException('The payment date cannot be in the future.');
    }
    const paymentId = await this.tenantDb.run(scope, async (tx) => {
      const [invoice] = await tx
        .select()
        .from(invoices)
        // No row lock: the organisation's database role may read invoices but never change them.
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organisationId, scope.organisationId)));
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status !== 'open') {
        throw new ConflictException(`This invoice is ${invoice.status}; nothing is due on it.`);
      }
      const [pending] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, invoiceId),
            eq(payments.organisationId, scope.organisationId),
            eq(payments.status, 'pending_verification'),
          ),
        );
      if (pending) {
        throw new ConflictException(
          'A payment for this invoice is already waiting for verification.',
        );
      }
      // Only the fields an organisation may fill in (the database role cannot write the rest).
      const created = (
        await tx.execute(sql`
          INSERT INTO payments (organisation_id, invoice_id, amount_minor, currency, method,
                                reference, paid_on, notes, reported_by_user_id)
          VALUES (${scope.organisationId}, ${invoiceId}, ${report.amountMinor}, ${invoice.currency},
                  ${report.method}, ${report.reference}, ${report.paidOn}, ${report.notes},
                  ${scope.userId})
          RETURNING id`)
      ).rows[0] as { id: string } | undefined;
      return created!.id;
    });
    await this.audit.record({
      action: 'payment.reported',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'payment',
      targetId: paymentId,
      metadata: {
        invoiceId,
        amountMinor: report.amountMinor,
        method: report.method,
        by: 'organisation',
      },
      meta,
    });
    return this.overview(scope);
  }

  private async history(tx: TenantTransaction, scope: TenantScope) {
    const invoiceRows = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.organisationId, scope.organisationId))
      .orderBy(desc(invoices.issuedAt));
    const paymentRows =
      invoiceRows.length === 0
        ? []
        : await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.organisationId, scope.organisationId),
                inArray(
                  payments.invoiceId,
                  invoiceRows.map((invoice) => invoice.id),
                ),
              ),
            )
            .orderBy(asc(payments.reportedAt));
    const names = await namesOf(
      tx,
      paymentRows.flatMap((payment) => [payment.reportedByUserId]),
    );
    return invoiceRows.map((invoice) => {
      const own = paymentRows.filter((payment) => payment.invoiceId === invoice.id);
      const verified = own
        .filter((payment) => payment.status === 'verified')
        .reduce((total, payment) => total + payment.amountMinor, 0);
      return {
        id: invoice.id,
        number: invoice.number,
        description: invoice.description,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        paidAt: invoice.paidAt,
        voidReason: invoice.voidReason,
        balanceMinor: invoice.status === 'open' ? Math.max(0, invoice.amountMinor - verified) : 0,
        payments: own.map((payment) => ({
          id: payment.id,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          method: payment.method,
          reference: payment.reference,
          paidOn: payment.paidOn,
          status: payment.status,
          reportedBy: payment.reportedByUserId
            ? (names.get(payment.reportedByUserId) ?? null)
            : null,
          reportedAt: payment.reportedAt,
          verifiedAt: payment.verifiedAt,
          rejectionReason: payment.rejectionReason,
          receiptNumber: payment.receiptNumber,
        })),
      };
    });
  }
}

async function namesOf(tx: TenantTransaction, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await tx
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((row) => [row.id, row.name]));
}
