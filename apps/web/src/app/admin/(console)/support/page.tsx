'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  Stat,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { CONSOLE_LOOK, TwoStepCard } from '@/components/two-step';
import { apiFetch, describeError, type SupportOverview } from '@/lib/api';
import { actionLabel, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useApi } from '@/lib/use-api';

function OrganisationList({
  items,
  empty,
  detail,
}: {
  items: { id: string; name: string }[];
  empty: string;
  detail?: (index: number) => string;
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y divide-ivory-100">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <Link
            href={`/admin/organisations/${item.id}`}
            className="font-medium text-navy-900 hover:underline"
          >
            {item.name}
          </Link>
          {detail && <span className="text-xs text-muted">{detail(index)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Lost phone and no recovery codes: removes someone's two-step sign-in so they can set it up
 * again. Confirm who is asking first (for example by calling a number you already have).
 */
function TwoStepResetCard() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiFetch<{ sessionsRevoked: number }>('/platform/two-step/reset', {
        method: 'POST',
        body: { email, reason },
      });
      setNotice({
        tone: 'good',
        text: `Two-step sign-in was reset for ${email}. They were signed out on ${result.sessionsRevoked} device(s) and told by email.`,
      });
      setEmail('');
      setReason('');
    } catch (caught) {
      setNotice({ tone: 'critical', text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Reset someone's two-step sign-in"
      description="For a person who lost their phone and their recovery codes. Confirm who is asking before you do this: it is recorded in the audit log and the person is emailed."
    >
      <form
        method="post"
        onSubmit={onSubmit}
        className="space-y-4"
        aria-label="Reset two-step sign-in"
      >
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <TextField
          label="Their email address"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Reason"
          hint="At least 10 characters, for example how you confirmed who they are."
          required
          minLength={10}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="danger" busy={busy}>
          Reset two-step sign-in
        </Button>
      </form>
    </Card>
  );
}

export default function SupportPage() {
  const support = useApi<SupportOverview>('/platform/support');

  return (
    <>
      <PageHeader
        title="Support"
        description="Accounts and organisations that may need attention. Email addresses are partly hidden."
      />
      {support.error ? <Alert>{describeError(support.error)}</Alert> : null}
      {!support.data && !support.error && <Loading />}
      {support.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat
              label="Failed sign-ins (24h)"
              value={formatNumber(support.data.counts.failedLogins24h)}
            />
            <Stat
              label="Blocked attempts (24h)"
              value={formatNumber(support.data.counts.rateLimited24h)}
              tone={support.data.counts.rateLimited24h > 0 ? 'warning' : undefined}
            />
            <Stat
              label="Permission refusals (24h)"
              value={formatNumber(support.data.counts.permissionDenied24h)}
            />
            <Stat
              label="Inactive accounts"
              value={formatNumber(support.data.counts.inactiveAccounts)}
            />
            <Stat
              label="Expired invitations (30d)"
              value={formatNumber(support.data.counts.expiredInvitations30d)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="No active owner" description="Active organisations nobody can administer.">
              <OrganisationList
                items={support.data.organisationsWithoutOwner}
                empty="Every organisation has an owner."
              />
            </Card>
            <Card title="Trials ending within 7 days">
              <OrganisationList
                items={support.data.trialsEndingSoon}
                empty="No trials ending soon."
                detail={(index) =>
                  formatDate(support.data!.trialsEndingSoon[index]?.currentPeriodEnd)
                }
              />
            </Card>
            <Card title="Payment attention" description="Past due or suspended subscriptions.">
              <OrganisationList
                items={support.data.paymentAttention}
                empty="No payment issues."
                detail={(index) =>
                  support.data!.paymentAttention[index]?.status.replace('_', ' ') ?? ''
                }
              />
            </Card>
          </div>

          <Card title="Recent security events (7 days)" description="Failed and refused actions.">
            {support.data.recentSecurityEvents.length === 0 ? (
              <EmptyState>No failed or refused actions.</EmptyState>
            ) : (
              <div className="-mx-5 overflow-x-auto sm:-mx-6">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-ivory-100 text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-5 py-2 font-medium sm:px-6">
                        When
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Event
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Outcome
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Target
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Network address
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ivory-100">
                    {support.data.recentSecurityEvents.map((event, index) => (
                      <tr key={`${event.occurredAt}-${index}`}>
                        <td className="px-5 py-2 whitespace-nowrap text-muted sm:px-6">
                          {formatDateTime(event.occurredAt)}
                        </td>
                        <td className="px-3 py-2 text-navy-900">{actionLabel(event.action)}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={event.outcome} />
                        </td>
                        <td className="px-3 py-2 text-muted">{event.targetId ?? '—'}</td>
                        <td className="px-3 py-2 text-muted">{event.ipAddress ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <TwoStepCard
          look={CONSOLE_LOOK}
          wrap={({ title, description, children }) => (
            <Card title={`Your ${title.toLowerCase()}`} description={description}>
              {children}
            </Card>
          )}
        />
        <TwoStepResetCard />
      </div>
    </>
  );
}
