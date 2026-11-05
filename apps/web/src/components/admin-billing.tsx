'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Loading, SelectField, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import {
  ACCESS_STATE_LABELS,
  ACCESS_TONE,
  formatMoney,
  LIMIT_LABELS,
  parseAmount,
  PAYMENT_METHOD_LABELS,
  PAYMENT_RECORD_LABELS,
  PAYMENT_STATUS_LABELS,
  PLAN_LIMITS,
  type InvoiceRecord,
  type PaymentMethod,
  type PaymentRecord,
  type PlatformBilling,
} from '@/lib/billing';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

type Run = (key: string, path: string, body?: unknown, success?: string) => Promise<boolean>;

/**
 * Billing for one organisation in the control centre: what the organisation can do now, the
 * subscription actions, invoices, and MANUAL payment verification (no payment provider).
 */
export function BillingCard({
  organisationId,
  onChanged,
}: {
  organisationId: string;
  onChanged: () => Promise<void>;
}) {
  const billing = useApi<PlatformBilling>(`/platform/organisations/${organisationId}/billing`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);

  const run: Run = async (key, path, body = {}, success = 'Saved.') => {
    setBusy(key);
    setNotice(null);
    try {
      billing.setData(
        await apiFetch<PlatformBilling>(`/platform/organisations/${organisationId}${path}`, {
          method: 'POST',
          body,
        }),
      );
      setNotice({ tone: 'good', text: success });
      await onChanged();
      return true;
    } catch (caught) {
      setNotice({ tone: 'critical', text: describeError(caught) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (billing.error && !billing.data) return <Alert>{describeError(billing.error)}</Alert>;
  if (!billing.data) return <Loading />;
  const { access, usage, subscription, invoices, events, organisation } = billing.data;
  const deleted = Boolean(organisation.deletedAt);
  const tone = deleted ? 'critical' : ACCESS_TONE[access.state];

  return (
    <Card
      title="Billing"
      description="Access is worked out by the server from the subscription, its invoices and today’s date."
      actions={<Badge tone={tone}>{deleted ? 'Ended' : ACCESS_STATE_LABELS[access.state]}</Badge>}
    >
      <div className="space-y-5" aria-label="Billing">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {deleted ? (
          <p data-testid="platform-access-message" className="text-sm text-navy-900">
            The organisation’s data was deleted on {formatDate(organisation.deletedAt)}, so its
            subscription has ended and nothing will renew. Existing invoices can still be settled or
            voided; no new invoices can be issued.
          </p>
        ) : (
          <div>
            <p data-testid="platform-access-message" className="text-sm text-navy-900">
              {access.message}
            </p>
            <p className="mt-1 text-sm text-muted">
              Payment status: {PAYMENT_STATUS_LABELS[access.paymentStatus]}
              {access.graceEndsAt ? ` · grace period ends ${formatDate(access.graceEndsAt)}` : ''}
              {access.dataRetainedUntil
                ? ` · data kept until at least ${formatDate(access.dataRetainedUntil)}`
                : ''}
            </p>
            {subscription?.suspensionReason && (
              <p className="mt-1 text-sm text-rose-800">
                Suspended: {subscription.suspensionReason}
              </p>
            )}
            {subscription?.cancellationReason && (
              <p className="mt-1 text-sm text-rose-800">
                Cancelled: {subscription.cancellationReason}
              </p>
            )}
          </div>
        )}

        {!deleted && (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {PLAN_LIMITS.map((limit) => (
              <div key={limit} className="flex justify-between gap-3">
                <dt className="text-muted">{LIMIT_LABELS[limit]}</dt>
                <dd className="font-medium text-navy-900">
                  {usage[limit]}
                  {access.limits[limit] === null ? ' / no limit' : ` / ${access.limits[limit]}`}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {subscription && !deleted && (
          <SubscriptionActions
            status={subscription.status}
            interval={subscription.billingInterval}
            busy={busy}
            run={run}
          />
        )}

        {subscription && !deleted && <IssueInvoice busy={busy} run={run} />}

        <div>
          <h3 className="text-sm font-semibold text-navy-900">Invoices</h3>
          {invoices.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No invoices.</p>
          ) : (
            <ul className="mt-2 space-y-3" aria-label="Invoices">
              {invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} invoice={invoice} busy={busy} run={run} />
              ))}
            </ul>
          )}
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-teal-600">
            Billing history ({events.length})
          </summary>
          <ul className="mt-2 divide-y divide-ivory-100 text-sm">
            {events.map((event) => (
              <li key={event.id} className="py-1.5">
                <span className="text-muted">
                  {formatDateTime(event.createdAt)}
                  {event.actor ? ` · ${event.actor}` : ''} ·{' '}
                </span>
                {event.summary}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}

function SubscriptionActions({
  status,
  interval,
  busy,
  run,
}: {
  status: string;
  interval: string;
  busy: string | null;
  run: Run;
}) {
  const [action, setAction] = useState<'suspend' | 'reactivate' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState<'period_end' | 'now'>('period_end');
  const inactive = status === 'suspended' || status === 'cancelled';

  return (
    <div>
      <h3 className="text-sm font-semibold text-navy-900">Subscription actions</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {!inactive && interval !== 'none' && (
          <Button
            variant="secondary"
            busy={busy === 'renew'}
            onClick={() =>
              void run('renew', '/subscription/renew', {}, 'Renewed for the next period.')
            }
          >
            Renew for the next period
          </Button>
        )}
        {status !== 'suspended' && (
          <Button variant="secondary" onClick={() => setAction('suspend')}>
            Suspend
          </Button>
        )}
        {inactive && (
          <Button variant="secondary" onClick={() => setAction('reactivate')}>
            Reactivate
          </Button>
        )}
        {status !== 'cancelled' && (
          <Button variant="secondary" onClick={() => setAction('cancel')}>
            Cancel subscription
          </Button>
        )}
      </div>
      {action && (
        <form method="post"
          className="mt-3 space-y-3 rounded-lg border border-ivory-100 p-3"
          aria-label={`${action[0]!.toUpperCase()}${action.slice(1)} subscription`}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void run(
              action,
              `/subscription/${action}`,
              action === 'cancel' ? { reason, when } : { reason },
              action === 'suspend'
                ? 'Subscription suspended.'
                : action === 'reactivate'
                  ? 'Subscription reactivated.'
                  : 'Subscription cancelled.',
            ).then((ok) => {
              if (ok) {
                setAction(null);
                setReason('');
              }
            });
          }}
        >
          <TextField
            label="Reason (recorded in the billing history and audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            required
          />
          {action === 'cancel' && (
            <SelectField
              label="When"
              value={when}
              onChange={(e) => setWhen(e.target.value as 'period_end' | 'now')}
              options={[
                { value: 'period_end', label: 'At the end of the current period' },
                { value: 'now', label: 'Straight away' },
              ]}
            />
          )}
          <div className="flex gap-2">
            <Button type="submit" busy={busy === action}>
              Confirm
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAction(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function IssueInvoice({ busy, run }: { busy: string | null; run: Run }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Issue an invoice
      </Button>
    );
  }
  return (
    <form method="post"
      className="space-y-3 rounded-lg border border-ivory-100 p-3"
      aria-label="Issue an invoice"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const amountMinor = parseAmount(amount);
        if (!amountMinor) {
          setError('Enter an amount, for example 1250.00.');
          return;
        }
        setError(null);
        void run(
          'invoice',
          '/invoices',
          {
            description,
            amountMinor,
            dueAt: new Date(`${due}T23:59:59Z`).toISOString(),
          },
          'Invoice issued.',
        ).then((ok) => ok && setOpen(false));
      }}
    >
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
        minLength={3}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          required
        />
        <TextField
          label="Due date"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          required
        />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" busy={busy === 'invoice'}>
          Issue invoice
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </form>
  );
}

function InvoiceRow({
  invoice,
  busy,
  run,
}: {
  invoice: InvoiceRecord;
  busy: string | null;
  run: Run;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <li
      aria-label={`Invoice ${invoice.number}`}
      className="rounded-lg border border-ivory-100 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy-900">{invoice.number}</span>
        <Badge
          tone={
            invoice.status === 'paid'
              ? 'good'
              : invoice.status === 'void'
                ? 'neutral'
                : new Date(invoice.dueAt) < new Date()
                  ? 'critical'
                  : 'warning'
          }
        >
          {invoice.status === 'open'
            ? new Date(invoice.dueAt) < new Date()
              ? 'Overdue'
              : 'Open'
            : invoice.status === 'paid'
              ? 'Paid'
              : 'Void'}
        </Badge>
        <span>
          {formatMoney(invoice.amountMinor, invoice.currency)} · due {formatDate(invoice.dueAt)}
        </span>
      </div>
      <p className="text-muted">{invoice.description}</p>
      {invoice.payments.length > 0 && (
        <ul className="mt-2 space-y-2">
          {invoice.payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} busy={busy} run={run} />
          ))}
        </ul>
      )}
      {invoice.status === 'open' && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!recording && (
            <Button variant="secondary" onClick={() => setRecording(true)}>
              Record a payment
            </Button>
          )}
          <Button
            variant="secondary"
            busy={busy === `void-${invoice.id}`}
            onClick={() => {
              const reason = window.prompt(
                'Why is this invoice being voided? (at least 10 characters)',
              );
              if (reason)
                void run(
                  `void-${invoice.id}`,
                  `/invoices/${invoice.id}/void`,
                  { reason },
                  'Invoice voided.',
                );
            }}
          >
            Void
          </Button>
        </div>
      )}
      {recording && (
        <RecordPayment invoice={invoice} busy={busy} run={run} onDone={() => setRecording(false)} />
      )}
    </li>
  );
}

function PaymentRow({
  payment,
  busy,
  run,
}: {
  payment: PaymentRecord;
  busy: string | null;
  run: Run;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li aria-label={`Payment ${payment.reference}`} className="rounded-md bg-ivory-50 p-2">
      <p>
        {formatMoney(payment.amountMinor, payment.currency)} ·{' '}
        {PAYMENT_METHOD_LABELS[payment.method]} · ref <strong>{payment.reference}</strong> · paid{' '}
        {formatDate(payment.paidOn)} · reported by {payment.reportedBy ?? 'a former member'} —{' '}
        <strong>{PAYMENT_RECORD_LABELS[payment.status]}</strong>
        {payment.receiptNumber ? ` · receipt ${payment.receiptNumber}` : ''}
        {payment.verifiedBy ? ` · verified by ${payment.verifiedBy}` : ''}
      </p>
      {payment.notes && <p className="text-muted">Note: {payment.notes}</p>}
      {payment.rejectionReason && <p className="text-rose-800">{payment.rejectionReason}</p>}
      {payment.status === 'pending_verification' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Manual verification — no payment provider is connected
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have checked the bank or mobile-money statement and this payment has arrived.
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              disabled={!confirmed}
              busy={busy === `verify-${payment.id}`}
              onClick={() =>
                void run(
                  `verify-${payment.id}`,
                  `/payments/${payment.id}/verify`,
                  { confirmed: true },
                  'Payment verified and receipt issued.',
                )
              }
            >
              Verify payment
            </Button>
            <div className="min-w-48 flex-1">
              <TextField
                label="Reason if it has not arrived"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              disabled={reason.trim().length < 10}
              busy={busy === `reject-${payment.id}`}
              onClick={() =>
                void run(
                  `reject-${payment.id}`,
                  `/payments/${payment.id}/reject`,
                  { reason },
                  'Payment marked as not verified.',
                )
              }
            >
              Not verified
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function RecordPayment({
  invoice,
  busy,
  run,
  onDone,
}: {
  invoice: InvoiceRecord;
  busy: string | null;
  run: Run;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState((invoice.amountMinor / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  return (
    <form method="post"
      className="mt-2 grid gap-3 rounded-lg border border-ivory-100 p-3 sm:grid-cols-2"
      aria-label={`Record a payment for ${invoice.number}`}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void run(
          `record-${invoice.id}`,
          `/invoices/${invoice.id}/payments`,
          { amountMinor: parseAmount(amount) ?? 0, method, reference, paidOn },
          'Payment recorded. It still needs verifying.',
        ).then((ok) => ok && onDone());
      }}
    >
      <TextField
        label="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      <SelectField
        label="Method"
        value={method}
        onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <TextField
        label="Reference"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        required
      />
      <TextField
        label="Date paid"
        type="date"
        value={paidOn}
        onChange={(e) => setPaidOn(e.target.value)}
        required
      />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" busy={busy === `record-${invoice.id}`}>
          Record payment
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Back
        </Button>
      </div>
    </form>
  );
}
