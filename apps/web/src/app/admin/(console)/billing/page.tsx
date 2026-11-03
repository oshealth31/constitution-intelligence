'use client';

import Link from 'next/link';
import { Alert, Card, EmptyState, Loading, PageHeader } from '@/components/ui';
import { describeError } from '@/lib/api';
import { ACCESS_STATE_LABELS, formatMoney, PAYMENT_METHOD_LABELS, type AccessState, type PaymentMethod } from '@/lib/billing';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Attention {
  pendingPayments: {
    id: string;
    organisationId: string;
    organisationName: string;
    invoiceNumber: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod;
    reference: string;
    paidOn: string;
    reportedAt: string;
  }[];
  overdueInvoices: {
    id: string;
    organisationId: string;
    organisationName: string;
    number: string;
    amountMinor: number;
    currency: string;
    dueAt: string;
  }[];
  renewalsDue: {
    organisationId: string;
    organisationName: string;
    planCode: string;
    status: string;
    currentPeriodEnd: string;
    autoRenew: boolean;
  }[];
  restricted: {
    organisationId: string;
    organisationName: string;
    state: AccessState;
    restrictedSince: string | null;
    dataRetainedUntil: string | null;
    retentionPassed: boolean;
  }[];
}

const link = (id: string, name: string) => (
  <Link href={`/admin/organisations/${id}`} className="font-medium text-navy-900 hover:underline">
    {name}
  </Link>
);

/** Billing work for Super Admins: payments to verify, overdue invoices, renewals, restricted organisations. */
export default function BillingAttentionPage() {
  const data = useApi<Attention>('/platform/billing/attention');
  if (data.error) return <Alert>{describeError(data.error)}</Alert>;
  if (!data.data) return <Loading />;
  const { pendingPayments, overdueInvoices, renewalsDue, restricted } = data.data;

  return (
    <>
      <PageHeader
        title="Billing"
        description="No payment provider is connected. Payments are reported by organisations (or recorded here) and count only after a Super Admin has checked that the money arrived."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Payments to verify (${pendingPayments.length})`} description="Check each against the bank or mobile-money statement.">
          {pendingPayments.length === 0 ? (
            <EmptyState>Nothing to verify.</EmptyState>
          ) : (
            <ul className="divide-y divide-ivory-100 text-sm" aria-label="Payments to verify">
              {pendingPayments.map((payment) => (
                <li key={payment.id} className="py-2">
                  {link(payment.organisationId, payment.organisationName)} · {payment.invoiceNumber} ·{' '}
                  {formatMoney(payment.amountMinor, payment.currency)} · {PAYMENT_METHOD_LABELS[payment.method]} · ref{' '}
                  {payment.reference} · paid {formatDate(payment.paidOn)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Overdue invoices (${overdueInvoices.length})`}>
          {overdueInvoices.length === 0 ? (
            <EmptyState>No overdue invoices.</EmptyState>
          ) : (
            <ul className="divide-y divide-ivory-100 text-sm">
              {overdueInvoices.map((invoice) => (
                <li key={invoice.id} className="py-2">
                  {link(invoice.organisationId, invoice.organisationName)} · {invoice.number} ·{' '}
                  {formatMoney(invoice.amountMinor, invoice.currency)} · due {formatDate(invoice.dueAt)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Periods ending in the next 14 days (${renewalsDue.length})`} description="Renew, or let them end. Nothing renews by itself.">
          {renewalsDue.length === 0 ? (
            <EmptyState>None.</EmptyState>
          ) : (
            <ul className="divide-y divide-ivory-100 text-sm">
              {renewalsDue.map((item) => (
                <li key={item.organisationId} className="py-2">
                  {link(item.organisationId, item.organisationName)} · {item.planCode} · ends{' '}
                  {formatDate(item.currentPeriodEnd)} · {item.autoRenew ? 'set to renew' : 'not renewing'}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title={`Restricted or suspended (${restricted.length})`}
          description="Data is kept for the retention period. When it has passed, review the organisation for deletion and contact the owner first — nothing is deleted automatically."
        >
          {restricted.length === 0 ? (
            <EmptyState>None.</EmptyState>
          ) : (
            <ul className="divide-y divide-ivory-100 text-sm">
              {restricted.map((item) => (
                <li key={item.organisationId} className="py-2">
                  {link(item.organisationId, item.organisationName)} · {ACCESS_STATE_LABELS[item.state]}
                  {item.dataRetainedUntil ? ` · data kept until ${formatDate(item.dataRetainedUntil)}` : ''}
                  {item.retentionPassed && <strong className="text-rose-800"> · due for deletion review</strong>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
