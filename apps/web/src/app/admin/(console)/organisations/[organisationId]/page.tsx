'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ColourField,
  EmptyState,
  Loading,
  PageHeader,
  ProgressBar,
  SelectField,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { apiFetch, describeError, type OrganisationDetail } from '@/lib/api';
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatMetric,
  formatNumber,
  metricLabel,
  roleLabel,
  statusLabel,
} from '@/lib/format';
import { BillingCard } from '@/components/admin-billing';
import { DeletionCard } from '@/components/admin-deletion';
import { FilesCard } from '@/components/admin-files';
import type { Plan } from '@/lib/billing';
import { useApi } from '@/lib/use-api';

type Notice = { tone: 'good' | 'critical'; text: string } | null;

/** Runs a change against the API and refreshes the page data from the response. */
function useAction(
  organisationId: string,
  setData: (value: OrganisationDetail) => void,
  setNotice: (notice: Notice) => void,
) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(
    key: string,
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    body: unknown,
    success: string,
    reload?: () => Promise<void>,
  ): Promise<boolean> {
    setBusy(key);
    setNotice(null);
    try {
      const result = await apiFetch<OrganisationDetail | undefined>(
        `/platform/organisations/${organisationId}${path}`,
        { method, body },
      );
      if (result && 'organisation' in result) setData(result);
      else if (reload) await reload();
      // Invitations: the API says whether the email actually went out.
      const emailFailed =
        typeof result === 'object' &&
        result !== null &&
        (result as { emailDelivered?: boolean }).emailDelivered === false;
      setNotice(
        emailFailed
          ? {
              tone: 'critical',
              text: 'The invitation was created, but the email could not be sent. Check the address and invite again, which sends a new email.',
            }
          : { tone: 'good', text: success },
      );
      return true;
    } catch (caught) {
      setNotice({ tone: 'critical', text: describeError(caught) });
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-navy-900">{children}</dd>
    </div>
  );
}

export default function OrganisationDetailPage() {
  const params = useParams<{ organisationId: string }>();
  const organisationId = params.organisationId;
  const detail = useApi<OrganisationDetail>(`/platform/organisations/${organisationId}`);
  const [notice, setNotice] = useState<Notice>(null);
  const { busy, run } = useAction(organisationId, detail.setData, setNotice);

  if (detail.error) return <Alert>{describeError(detail.error)}</Alert>;
  if (!detail.data) return <Loading />;
  const data = detail.data;

  // A deleted organisation: only what was deleted, and the financial records that were kept.
  if (data.organisation.deletedAt) {
    return (
      <>
        <p className="mb-2 text-sm">
          <Link href="/admin/organisations" className="text-teal-600 hover:underline">
            ← Organisations
          </Link>
        </p>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              {data.organisation.name} <Badge tone="critical">Deleted</Badge>
            </span>
          }
          description={`Data deleted ${formatDate(data.organisation.deletedAt)}`}
        />
        <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <DeletionCard organisationId={organisationId} onDeleted={detail.reload} />
          <BillingCard organisationId={organisationId} onChanged={detail.reload} />
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/organisations" className="text-teal-600 hover:underline">
          ← Organisations
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {data.organisation.name} <StatusBadge status={data.organisation.status} />
          </span>
        }
        description={`${data.organisation.slug} · created ${formatDate(data.organisation.createdAt)}`}
        actions={
          <Link
            href={`/admin/audit?organisationId=${organisationId}`}
            className="text-sm font-medium text-teal-600 hover:underline"
          >
            View audit log
          </Link>
        }
      />
      {notice && (
        <div className="mb-6">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <DetailsCard data={data} busy={busy} run={run} />
          <AdministratorsCard data={data} busy={busy} run={run} reload={detail.reload} />
          <SubscriptionCard
            key={data.subscription?.id ?? 'none'}
            data={data}
            busy={busy}
            run={run}
          />
          <BillingCard organisationId={organisationId} onChanged={detail.reload} />
          <BrandingCard data={data} busy={busy} run={run} />
          <SupportAccessCard organisationId={organisationId} />
          <FilesCard organisationId={organisationId} />
          <DeletionCard organisationId={organisationId} onDeleted={detail.reload} />
        </div>
        <div className="space-y-6">
          <Card title="Onboarding" description="How far this organisation has got.">
            <ProgressBar
              value={data.onboarding.completed}
              total={data.onboarding.total}
              label="Onboarding progress"
            />
            <ul className="mt-4 space-y-2">
              {data.onboarding.steps.map((step) => (
                <li key={step.key} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={`flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      step.done
                        ? 'bg-teal-500 text-white'
                        : 'border border-slate-300 text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className={step.done ? 'text-navy-900' : 'text-muted'}>
                    {step.label}
                    <span className="sr-only">{step.done ? ' (done)' : ' (not yet)'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Constitution processing">
            {data.processing.latestVersion ? (
              <dl className="divide-y divide-ivory-100">
                <Row label="Latest version">
                  v{data.processing.latestVersion.versionNumber} ·{' '}
                  {data.processing.latestVersion.label}
                </Row>
                <Row label="Stage">
                  <StatusBadge status={data.processing.latestVersion.status} />
                </Row>
                <Row label="Text extracted">
                  {data.processing.latestVersion.textExtracted ? 'Yes' : 'No'}
                </Row>
                <Row label="Sections">
                  {formatNumber(data.processing.latestVersion.sectionCount)}
                </Row>
                <Row label="Updated">{formatDateTime(data.processing.latestVersion.updatedAt)}</Row>
                <Row label="Files">
                  {formatNumber(data.processing.files)} ({formatBytes(data.processing.storageBytes)}
                  )
                </Row>
              </dl>
            ) : (
              <EmptyState>No constitution uploaded yet.</EmptyState>
            )}
            {data.processing.versionsByStatus.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.processing.versionsByStatus.map((item) => (
                  <Badge key={item.status}>
                    {statusLabel(item.status)}: {item.count}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
          <Card title="Members" description="Active members by role (names are not shown).">
            {data.memberCounts.length === 0 ? (
              <EmptyState>No members yet.</EmptyState>
            ) : (
              <dl className="divide-y divide-ivory-100">
                {data.memberCounts.map((item) => (
                  <Row key={item.role} label={roleLabel(item.role)}>
                    {formatNumber(item.count)}
                  </Row>
                ))}
              </dl>
            )}
          </Card>
          <Card title="Usage (30 days)">
            {data.usage30d.length === 0 ? (
              <EmptyState>No usage recorded.</EmptyState>
            ) : (
              <dl className="divide-y divide-ivory-100">
                {data.usage30d.map((item) => (
                  <Row key={item.metric} label={metricLabel(item.metric)}>
                    {formatMetric(item.metric, item.total)}
                  </Row>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

type RunAction = ReturnType<typeof useAction>['run'];
interface SectionProps {
  data: OrganisationDetail;
  busy: string | null;
  run: RunAction;
}

function DetailsCard({ data, busy, run }: SectionProps) {
  const [name, setName] = useState(data.organisation.name);
  const [slug, setSlug] = useState(data.organisation.slug);
  const [reason, setReason] = useState('');
  const isActive = data.organisation.status === 'active';

  return (
    <Card title="Organisation details" description="Name, web address and access status.">
      <form
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Organisation details"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const body: Record<string, string> = {};
          if (name !== data.organisation.name) body.name = name;
          if (slug !== data.organisation.slug) body.slug = slug;
          if (Object.keys(body).length === 0) return;
          void run('details', 'PATCH', '', body, 'Organisation details saved.');
        }}
      >
        <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Web address (slug)"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" busy={busy === 'details'}>
            Save details
          </Button>
        </div>
      </form>

      <form
        className="mt-6 border-t border-ivory-100 pt-5"
        aria-label={isActive ? 'Suspend organisation' : 'Activate organisation'}
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const ok = await run(
            'status',
            'POST',
            '/status',
            { status: isActive ? 'suspended' : 'active', reason },
            isActive
              ? 'Organisation suspended. Its members can no longer sign in to it.'
              : 'Organisation activated.',
          );
          if (ok) setReason('');
        }}
      >
        <h3 className="text-sm font-semibold text-navy-900">
          {isActive ? 'Suspend access' : 'Restore access'}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {isActive
            ? 'Suspending blocks every member of this organisation immediately. Data is kept.'
            : 'Activating lets the organisation’s members use the platform again.'}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField
            label="Reason (recorded in the audit log)"
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" variant={isActive ? 'danger' : 'primary'} busy={busy === 'status'}>
            {isActive ? 'Suspend organisation' : 'Activate organisation'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AdministratorsCard({
  data,
  busy,
  run,
  reload,
}: SectionProps & { reload: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('owner');

  return (
    <Card
      title="Administrators"
      description="Owners and Administrators of this organisation. Ordinary members are not listed here."
    >
      {data.administrators.length === 0 ? (
        <EmptyState>No owner yet. Invite one below to complete onboarding.</EmptyState>
      ) : (
        <ul className="divide-y divide-ivory-100">
          {data.administrators.map((admin) => {
            const suspended = admin.membershipStatus !== 'active';
            return (
              <li
                key={admin.membershipId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-900">
                    {admin.displayName} <Badge tone="info">{roleLabel(admin.role)}</Badge>
                  </p>
                  <p className="truncate text-xs text-muted">
                    {admin.email} · last sign-in {formatDateTime(admin.lastSignInAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={admin.membershipStatus} />
                  <Button
                    variant={suspended ? 'secondary' : 'ghost'}
                    busy={busy === admin.membershipId}
                    onClick={() =>
                      void run(
                        admin.membershipId,
                        'PATCH',
                        `/administrators/${admin.membershipId}`,
                        { status: suspended ? 'active' : 'suspended' },
                        suspended ? 'Administrator reactivated.' : 'Administrator suspended.',
                      )
                    }
                  >
                    {suspended ? 'Reactivate' : 'Suspend'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data.administratorInvitations.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-navy-900">Pending invitations</h3>
          <ul className="mt-2 divide-y divide-ivory-100">
            {data.administratorInvitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="text-navy-900">
                  {invitation.email} · {roleLabel(invitation.role)}
                  <span className="block text-xs text-muted">
                    expires {formatDateTime(invitation.expiresAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  busy={busy === invitation.id}
                  onClick={() =>
                    void run(
                      invitation.id,
                      'POST',
                      `/invitations/${invitation.id}/revoke`,
                      undefined,
                      'Invitation revoked.',
                      reload,
                    )
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-6 grid gap-3 border-t border-ivory-100 pt-5 sm:grid-cols-[1fr_180px_auto] sm:items-end"
        aria-label="Invite an administrator"
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const ok = await run(
            'invite',
            'POST',
            '/administrator-invitations',
            { email, role },
            `Invitation sent to ${email}.`,
            reload,
          );
          if (ok) setEmail('');
        }}
      >
        <TextField
          label="Invite by email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <SelectField
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          options={[
            { value: 'owner', label: 'Owner' },
            { value: 'admin', label: 'Administrator' },
          ]}
        />
        <Button type="submit" busy={busy === 'invite'}>
          Send invitation
        </Button>
      </form>
    </Card>
  );
}

function SubscriptionCard({ data, busy, run }: SectionProps) {
  const planList = useApi<Plan[]>('/platform/plans');
  const [planCode, setPlanCode] = useState(data.subscription?.planCode ?? 'trial');
  const [status, setStatus] = useState(
    data.subscription?.status === 'trialing' ? 'trialing' : 'active',
  );
  const [billing, setBilling] = useState(data.subscription?.billingInterval ?? 'monthly');
  const [autoRenew, setAutoRenew] = useState(data.subscription?.autoRenew ?? true);
  const [periodEnd, setPeriodEnd] = useState(
    data.subscription?.currentPeriodEnd?.slice(0, 10) ?? '',
  );
  const plans = (planList.data ?? []).filter(
    (plan) => plan.active || plan.code === data.subscription?.planCode,
  );
  const blocked =
    data.subscription?.status === 'suspended' || data.subscription?.status === 'cancelled';

  return (
    <Card
      title="Subscription"
      description="Plan, billing and dates. Recorded by hand: no payment provider is connected. Suspension, cancellation, renewal, invoices and payments are under Billing below."
      actions={data.subscription ? <StatusBadge status={data.subscription.status} /> : undefined}
    >
      {blocked && (
        <div className="mb-4">
          <Alert tone="info">
            This subscription is {data.subscription?.status}. Reactivate it under Billing before
            changing it.
          </Alert>
        </div>
      )}
      <form
        className="grid gap-4 sm:grid-cols-3 sm:items-end"
        aria-label="Subscription"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void run(
            'subscription',
            'PUT',
            '/subscription',
            {
              planCode,
              status,
              billingInterval:
                status === 'trialing' ? 'none' : billing === 'none' ? 'monthly' : billing,
              autoRenew,
              currentPeriodEnd: periodEnd ? new Date(`${periodEnd}T23:59:59Z`).toISOString() : null,
            },
            'Subscription updated.',
          );
        }}
      >
        <SelectField
          label="Plan"
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          options={plans.map((plan) => ({
            value: plan.code,
            label: `${plan.name}${plan.isPilot ? ' (pilot)' : ''}${plan.active ? '' : ' — no longer offered'}`,
          }))}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: 'trialing', label: 'Pilot (not billed)' },
            { value: 'active', label: 'Active (billed)' },
          ]}
        />
        <SelectField
          label="Billing"
          value={status === 'trialing' ? 'none' : billing === 'none' ? 'monthly' : billing}
          disabled={status === 'trialing'}
          onChange={(e) => setBilling(e.target.value as 'monthly' | 'annual')}
          options={
            status === 'trialing'
              ? [{ value: 'none', label: 'Not billed' }]
              : [
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'annual', label: 'Annual' },
                ]
          }
        />
        <TextField
          label="Period ends (paid until / pilot ends)"
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm font-medium text-navy-900 sm:col-span-2">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            disabled={status === 'trialing'}
          />
          Renews at the end of the period
        </label>
        <div className="sm:col-span-3">
          <Button
            type="submit"
            variant="secondary"
            busy={busy === 'subscription'}
            disabled={blocked}
          >
            Save subscription
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BrandingCard({ data, busy, run }: SectionProps) {
  const [displayName, setDisplayName] = useState(data.branding?.displayName ?? '');
  const [tagline, setTagline] = useState(data.branding?.tagline ?? '');
  const [primaryColour, setPrimaryColour] = useState(data.branding?.primaryColour ?? '#0B1F3A');
  const [accentColour, setAccentColour] = useState(data.branding?.accentColour ?? '#1BA6A6');
  const [secondaryColour, setSecondaryColour] = useState(
    data.branding?.secondaryColour ?? '#F5EFE2',
  );

  return (
    <Card
      title="Branding"
      description={
        <>
          How the organisation&apos;s portal looks to its members.{' '}
          <a
            href={`/o/${data.organisation.slug}/sign-in`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-600 underline underline-offset-4"
          >
            Open portal sign-in page
          </a>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
        <form
          className="grid gap-4 sm:grid-cols-2"
          aria-label="Branding"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void run(
              'branding',
              'PATCH',
              '/branding',
              {
                displayName: displayName.trim() || null,
                tagline: tagline.trim() || null,
                primaryColour,
                secondaryColour,
                accentColour,
              },
              'Branding saved.',
            );
          }}
        >
          <TextField
            label="Display name"
            maxLength={200}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <TextField
            label="Tagline"
            maxLength={300}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
          />
          <ColourField label="Primary colour" value={primaryColour} onChange={setPrimaryColour} />
          <ColourField
            label="Secondary colour"
            value={secondaryColour}
            onChange={setSecondaryColour}
          />
          <ColourField label="Accent colour" value={accentColour} onChange={setAccentColour} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" busy={busy === 'branding'}>
              Save branding
            </Button>
          </div>
        </form>
        <div
          aria-label="Branding preview"
          className="overflow-hidden rounded-xl border border-ivory-100"
        >
          <div
            className="px-4 py-3 text-sm font-semibold text-white"
            style={{ backgroundColor: primaryColour }}
          >
            {displayName || data.organisation.name}
          </div>
          <div className="space-y-2 p-4" style={{ backgroundColor: secondaryColour }}>
            <p className="text-xs text-muted">{tagline || 'Tagline appears here'}</p>
            <span
              className="inline-block rounded-md px-3 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: accentColour }}
            >
              Read the constitution
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface SupportSection {
  id: string;
  refKey: string;
  number: string | null;
  heading: string | null;
  body: string;
  versionLabel: string;
}

function SupportAccessCard({ organisationId }: { organisationId: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<SupportSection[] | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ sections: SupportSection[] }>(
        `/platform/organisations/${organisationId}/support-access`,
        { method: 'POST', body: { reason } },
      );
      setSections(result.sections);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Support access to content"
      description="Constitution text is hidden by default. Viewing it requires a reason and is recorded in both the platform audit log and this organisation's own audit log."
    >
      {sections === null ? (
        <form onSubmit={onSubmit} className="space-y-3" aria-label="Request support access">
          {error && <Alert>{error}</Alert>}
          <TextField
            label="Reason for viewing (for example, a support ticket reference)"
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" variant="secondary" busy={busy}>
            View published constitution
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <Alert tone="info">This access has been recorded. Close it when you are finished.</Alert>
          {sections.length === 0 ? (
            <EmptyState>No published constitution yet.</EmptyState>
          ) : (
            <ol className="max-h-96 space-y-3 overflow-y-auto pr-2">
              {sections.map((section) => (
                <li key={section.id} className="rounded-lg bg-ivory-50 p-3 text-sm">
                  <p className="font-medium text-navy-900">
                    {section.number ? `${section.number}. ` : ''}
                    {section.heading}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-ink">{section.body}</p>
                </li>
              ))}
            </ol>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setSections(null);
              setReason('');
            }}
          >
            Close content
          </Button>
        </div>
      )}
    </Card>
  );
}
