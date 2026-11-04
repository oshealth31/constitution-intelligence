'use client';

import { useState, type FormEvent } from 'react';
import { StatusBadge } from '@/components/ui';
import { Notice, Panel, PortalButton, PortalLoading } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatDate, roleLabel } from '@/lib/format';
import { can, type Invitation, type Member } from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const ROLE_CHOICES = [
  { value: 'member', label: 'Member — can read and search' },
  { value: 'content_reviewer', label: 'Content reviewer — checks and approves documents' },
  { value: 'auditor', label: 'Auditor — read-only oversight' },
  { value: 'admin', label: 'Administrator — manages members and branding' },
  { value: 'owner', label: 'Owner — full control' },
];

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

type Message = { tone: 'success' | 'error'; text: string } | null;

/** Members and invitations. The API decides who may invite or change whom. */
export default function MembersPage() {
  const { api, home, user } = usePortal();
  const members = useApi<Member[]>(`${api}/members`);
  const invitations = useApi<Invitation[]>(`${api}/invitations`);
  const canInvite = can(home.you.permissions, 'members.invite');
  const canChange = can(home.you.permissions, 'members.manage');

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [rowMessage, setRowMessage] = useState<Message>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setMessage(null);
    try {
      const created = await apiFetch<{ emailDelivered?: boolean }>(`${api}/invitations`, {
        method: 'POST',
        body: { email, role },
      });
      setEmail('');
      setMessage(
        created?.emailDelivered === false
          ? {
              tone: 'error',
              text: `${email}: The invitation was created, but the email could not be sent. Check the address and invite again, which sends a new email.`,
            }
          : { tone: 'success', text: `Invitation sent to ${email}.` },
      );
      await invitations.reload();
    } catch (error) {
      setMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setInviting(false);
    }
  }

  async function act(id: string, run: () => Promise<unknown>, success: string) {
    setBusyId(id);
    setRowMessage(null);
    try {
      await run();
      setRowMessage({ tone: 'success', text: success });
      await Promise.all([members.reload(), invitations.reload()]);
    } catch (error) {
      setRowMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setBusyId(null);
    }
  }

  const pending = (invitations.data ?? []).filter((invitation) => invitation.status === 'pending');

  return (
    <div className="space-y-5">
      {canInvite && (
        <Panel title="Invite someone" description="They will receive an email with a link to join.">
          <form
            onSubmit={invite}
            className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            aria-label="Invite someone"
          >
            <label className="block text-base font-medium text-slate-900">
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block text-base font-medium text-slate-900">
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className={FIELD}
              >
                {ROLE_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <PortalButton type="submit" busy={inviting}>
              Send invitation
            </PortalButton>
          </form>
          {message && (
            <div className="mt-4">
              <Notice tone={message.tone}>{message.text}</Notice>
            </div>
          )}
        </Panel>
      )}

      {rowMessage && <Notice tone={rowMessage.tone}>{rowMessage.text}</Notice>}

      <Panel title="Members">
        {members.loading && !members.data && <PortalLoading />}
        {members.error !== undefined && (
          <Notice tone="error">{describeError(members.error)}</Notice>
        )}
        <ul className="divide-y divide-slate-200">
          {members.data?.map((member) => {
            const isYou = member.userId === user.id;
            return (
              <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    {member.displayName}
                    {isYou && <span className="font-normal text-slate-500"> (you)</span>}
                  </p>
                  <p className="text-sm break-all text-slate-600">{member.email}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                    {roleLabel(member.role)} <StatusBadge status={member.status} />
                  </p>
                </div>
                {canChange && !isYou && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${member.membershipId}`}>
                      Role for {member.displayName}
                    </label>
                    <select
                      id={`role-${member.membershipId}`}
                      value={member.role}
                      disabled={busyId === member.membershipId}
                      onChange={(event) =>
                        act(
                          member.membershipId,
                          () =>
                            apiFetch(`${api}/members/${member.membershipId}`, {
                              method: 'PATCH',
                              body: { role: event.target.value },
                            }),
                          `${member.displayName} is now ${roleLabel(event.target.value)}.`,
                        )
                      }
                      className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
                    >
                      {ROLE_CHOICES.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {roleLabel(choice.value)}
                        </option>
                      ))}
                    </select>
                    <PortalButton
                      variant="secondary"
                      className="min-h-11 py-2"
                      busy={busyId === member.membershipId}
                      onClick={() =>
                        act(
                          member.membershipId,
                          () =>
                            apiFetch(`${api}/members/${member.membershipId}`, {
                              method: 'PATCH',
                              body: { status: member.status === 'active' ? 'suspended' : 'active' },
                            }),
                          member.status === 'active'
                            ? `${member.displayName} has been suspended.`
                            : `${member.displayName} is active again.`,
                        )
                      }
                    >
                      {member.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </PortalButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Waiting to join">
        {invitations.loading && !invitations.data && <PortalLoading />}
        {invitations.data && pending.length === 0 && (
          <p className="text-base text-slate-600">No invitations are waiting.</p>
        )}
        <ul className="divide-y divide-slate-200">
          {pending.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-all text-slate-900">{invitation.email}</p>
                <p className="text-sm text-slate-600">
                  {roleLabel(invitation.role)} · link expires {formatDate(invitation.expiresAt)}
                </p>
              </div>
              {canInvite && (
                <PortalButton
                  variant="secondary"
                  className="min-h-11 py-2"
                  busy={busyId === invitation.id}
                  onClick={() =>
                    act(
                      invitation.id,
                      () =>
                        apiFetch(`${api}/invitations/${invitation.id}/revoke`, { method: 'POST' }),
                      `The invitation to ${invitation.email} has been cancelled.`,
                    )
                  }
                >
                  Cancel invitation
                </PortalButton>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
