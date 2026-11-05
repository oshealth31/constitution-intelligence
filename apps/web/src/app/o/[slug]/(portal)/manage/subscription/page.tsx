'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { WidthBar } from '@/components/brand-scope';
import { Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import {
  ACCESS_STATE_LABELS,
  ACCESS_TONE,
  containsCardNumber,
  FEATURE_LABELS,
  formatMoney,
  LIMIT_LABELS,
  parseAmount,
  PAYMENT_METHOD_LABELS,
  PAYMENT_RECORD_LABELS,
  PAYMENT_STATUS_LABELS,
  PLAN_FEATURES,
  PLAN_LIMITS,
  amountText,
  type InvoiceRecord,
  type OrganisationBilling,
  type PaymentMethod,
} from '@/lib/billing';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

const TONE: Record<string, 'good' | 'info' | 'warning' | 'critical'> = ACCESS_TONE;

/** The organisation's subscription: plan, status, usage, invoices, payments and receipts. */
export default function SubscriptionPage() {
  const { api, home } = usePortal();
  const billing = useApi<OrganisationBilling>(`${api}/billing`);
  const canPay = can(home.you.permissions, 'billing.manage');

  if (billing.loading && !billing.data) return <PortalLoading />;
  if (!billing.data) return <Notice tone="error">{describeError(billing.error)}</Notice>;
  const { access, subscription, usage, invoices, events, manualPayments, retention } = billing.data;

  return (
    <div className="space-y-5">
      <Panel title="Your subscription">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold text-slate-900">
            {subscription ? `${subscription.planName} plan` : 'No subscription'}
          </p>
          <Badge tone={TONE[access.state]}>{ACCESS_STATE_LABELS[access.state]}</Badge>
          <Badge tone={access.paymentStatus === 'overdue' ? 'critical' : 'neutral'}>
            {PAYMENT_STATUS_LABELS[access.paymentStatus]}
          </Badge>
        </div>
        <p data-testid="access-message" className="mt-2 text-base text-slate-800">
          {access.message}
        </p>
        {subscription && (
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-base sm:grid-cols-2">
            <Fact label="Billing">
              {subscription.billingInterval === 'none'
                ? 'Not billed (pilot)'
                : subscription.billingInterval === 'monthly'
                  ? 'Monthly'
                  : 'Annual'}
            </Fact>
            <Fact label="Price">
              {subscription.billingInterval === 'monthly' && subscription.monthlyPriceMinor !== null
                ? `${formatMoney(subscription.monthlyPriceMinor, subscription.currency)} a month`
                : subscription.billingInterval === 'annual' &&
                    subscription.annualPriceMinor !== null
                  ? `${formatMoney(subscription.annualPriceMinor, subscription.currency)} a year`
                  : 'As agreed with Constitution Intelligence'}
            </Fact>
            <Fact label="Started">{formatDate(subscription.currentPeriodStart)}</Fact>
            <Fact
              label={subscription.billingInterval === 'none' ? 'Pilot ends' : 'Current period ends'}
            >
              {subscription.currentPeriodEnd
                ? formatDate(subscription.currentPeriodEnd)
                : 'No end date'}
            </Fact>
            <Fact label="Renewal">
              {access.renewal === 'renews'
                ? 'Renews at the end of the period'
                : access.renewal === 'ends'
                  ? 'Does not renew'
                  : 'Not applicable'}
            </Fact>
            <Fact label="Grace period">
              {subscription.graceDays} days after the period ends or an invoice is due
            </Fact>
          </dl>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Included in your plan">
          <ul className="space-y-1 text-base" aria-label="Features">
            <li className="text-slate-900">✓ Reading, search and “find relevant clauses”</li>
            {PLAN_FEATURES.map((feature) => (
              <li
                key={feature}
                className={access.features.includes(feature) ? 'text-slate-900' : 'text-slate-500'}
              >
                {access.features.includes(feature) ? '✓' : '✗'} {FEATURE_LABELS[feature]}
                {!access.features.includes(feature) && (
                  <span className="sr-only"> (not included)</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Usage and limits">
          <ul className="space-y-3" aria-label="Usage">
            {PLAN_LIMITS.map((limit) => {
              const allowed = access.limits[limit];
              const used = usage[limit];
              const share = allowed ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
              return (
                <li key={limit}>
                  <p className="flex justify-between text-base text-slate-800">
                    <span>{LIMIT_LABELS[limit]}</span>
                    <span className="font-medium">
                      {used}
                      {allowed === null ? ' (no limit)' : ` of ${allowed}`}
                    </span>
                  </p>
                  {allowed !== null && allowed > 0 && (
                    <div
                      className="mt-1 h-2 rounded-full bg-slate-100"
                      role="progressbar"
                      aria-label={LIMIT_LABELS[limit]}
                      aria-valuenow={share}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <WidthBar
                        percent={share}
                        className={`h-2 rounded-full ${share >= 90 ? 'bg-rose-500' : 'bg-[var(--brand-accent)]'}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Invoices and payments">
        <Notice tone="info">
          <strong>Manual payment verification.</strong> {manualPayments.notice}
        </Notice>
        <p className="mt-3 text-base whitespace-pre-line text-slate-800">
          <strong>How to pay:</strong> {manualPayments.instructions}
        </p>
        {invoices.length === 0 ? (
          <p className="mt-4 text-base text-slate-600">No invoices yet.</p>
        ) : (
          <ol className="mt-4 space-y-4" aria-label="Invoices">
            {invoices.map((invoice) => (
              <InvoiceItem
                key={invoice.id}
                invoice={invoice}
                canPay={canPay}
                onChanged={(next) => billing.setData(next)}
              />
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Billing history">
        {events.length === 0 ? (
          <p className="text-base text-slate-600">Nothing has happened yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200" aria-label="Billing history">
            {events.map((event) => (
              <li key={event.id} className="py-2 text-base">
                <span className="text-sm text-slate-500">{formatDate(event.createdAt)} · </span>
                {event.summary}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="What happens to our data if the subscription ends">
        <ul className="list-disc space-y-1 pl-5 text-base text-slate-800">
          {retention.policy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-slate-600">
          Retention period: {retention.days} days.
          {access.dataRetainedUntil
            ? ` Your data is kept until at least ${formatDate(access.dataRetainedUntil)}.`
            : ''}
        </p>
      </Panel>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

function InvoiceItem({
  invoice,
  canPay,
  onChanged,
}: {
  invoice: InvoiceRecord;
  canPay: boolean;
  onChanged: (billing: OrganisationBilling) => void;
}) {
  const pending = invoice.payments.some((payment) => payment.status === 'pending_verification');
  const overdue = invoice.status === 'open' && new Date(invoice.dueAt) < new Date();
  return (
    <li
      aria-label={`Invoice ${invoice.number}`}
      className="rounded-2xl border border-slate-200 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-900">{invoice.number}</p>
        <Badge
          tone={
            invoice.status === 'paid'
              ? 'good'
              : invoice.status === 'void'
                ? 'neutral'
                : overdue
                  ? 'critical'
                  : 'warning'
          }
        >
          {invoice.status === 'paid'
            ? 'Paid'
            : invoice.status === 'void'
              ? 'Cancelled'
              : overdue
                ? 'Overdue'
                : 'Due'}
        </Badge>
      </div>
      <p className="mt-1 text-base text-slate-800">
        {invoice.description} ·{' '}
        <strong>{formatMoney(invoice.amountMinor, invoice.currency)}</strong>
      </p>
      <p className="text-sm text-slate-600">
        Issued {formatDate(invoice.issuedAt)} · due {formatDate(invoice.dueAt)}
        {invoice.periodStart && invoice.periodEnd
          ? ` · for ${formatDate(invoice.periodStart)} to ${formatDate(invoice.periodEnd)}`
          : ''}
        {invoice.paidAt ? ` · paid ${formatDate(invoice.paidAt)}` : ''}
      </p>
      {invoice.payments.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label={`Payments for ${invoice.number}`}>
          {invoice.payments.map((payment) => (
            <li key={payment.id} className="rounded-xl bg-slate-50 px-3 py-2 text-base">
              {formatMoney(payment.amountMinor, payment.currency)} by{' '}
              {PAYMENT_METHOD_LABELS[payment.method]} on {formatDate(payment.paidOn)} (reference{' '}
              {payment.reference}) — <strong>{PAYMENT_RECORD_LABELS[payment.status]}</strong>
              {payment.receiptNumber && (
                <span data-testid="receipt"> · Receipt {payment.receiptNumber}</span>
              )}
              {payment.rejectionReason && (
                <span className="block text-sm text-rose-800">{payment.rejectionReason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {invoice.status === 'open' && canPay && !pending && (
        <ReportPayment invoice={invoice} onChanged={onChanged} />
      )}
      {invoice.status === 'open' && !canPay && (
        <p className="mt-2 text-sm text-slate-600">
          Only the organisation’s owner can report a payment.
        </p>
      )}
    </li>
  );
}

function ReportPayment({
  invoice,
  onChanged,
}: {
  invoice: InvoiceRecord;
  onChanged: (billing: OrganisationBilling) => void;
}) {
  const { api } = usePortal();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(amountText(invoice.balanceMinor ?? invoice.amountMinor));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter the amount paid, for example 250.00.');
      return;
    }
    if (containsCardNumber(reference) || containsCardNumber(notes)) {
      setError(
        'This looks like a card number. Never enter card details — only the payment reference.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await apiFetch<OrganisationBilling>(`${api}/billing/invoices/${invoice.id}/payments`, {
          method: 'POST',
          body: { amountMinor, method, reference, paidOn, notes },
        }),
      );
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <PortalButton variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
        Report a payment
      </PortalButton>
    );
  }
  return (
    <form method="post"
      onSubmit={submit}
      aria-label={`Report a payment for ${invoice.number}`}
      className="mt-3 space-y-3"
    >
      <Notice tone="warning">
        Do not enter card details. Give the reference from your bank transfer or mobile-money
        payment. The invoice is marked as paid only after Constitution Intelligence has checked that
        the money arrived.
      </Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-base font-medium text-slate-900">
          Amount paid ({invoice.currency})
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
            className={FIELD}
          />
        </label>
        <label className="block text-base font-medium text-slate-900">
          How you paid
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className={FIELD}
          >
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-base font-medium text-slate-900">
          Payment reference
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={100}
            required
            className={FIELD}
          />
        </label>
        <label className="block text-base font-medium text-slate-900">
          Date paid
          <input
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            required
            className={FIELD}
          />
        </label>
      </div>
      <label className="block text-base font-medium text-slate-900">
        Notes (optional)
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
          rows={2}
          className={FIELD}
        />
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-3">
        <PortalButton type="submit" busy={busy}>
          Send for verification
        </PortalButton>
        <PortalButton type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </PortalButton>
      </div>
    </form>
  );
}
