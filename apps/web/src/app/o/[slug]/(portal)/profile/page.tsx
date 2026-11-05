'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Notice, Panel, PortalButton, PortalHeading, UserIcon } from '@/components/portal-ui';
import { OfflineCard } from '@/components/offline-ui';
import { PORTAL_LOOK, TwoStepCard } from '@/components/two-step';
import { apiFetch, describeError } from '@/lib/api';
import { clearAllOfflineData } from '@/lib/offline-store';
import { portalPath } from '@/lib/portal';
import { usePortal } from '../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

/** The signed-in person's own details, password and sign-out. */
export default function ProfilePage() {
  const { user, home, slug, reload } = usePortal();
  const router = useRouter();

  const [name, setName] = useState(user.displayName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);
  const [signingOut, setSigningOut] = useState<'here' | 'everywhere' | null>(null);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameBusy(true);
    setNameMessage(null);
    try {
      await apiFetch('/auth/me', { method: 'PATCH', body: { displayName: name } });
      await reload();
      setNameMessage({ tone: 'success', text: 'Your name has been saved.' });
    } catch (error) {
      setNameMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setNameBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordBusy(true);
    setPasswordMessage(null);
    try {
      await apiFetch('/auth/password/change', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage({
        tone: 'success',
        text: 'Your password has been changed. Other devices have been signed out.',
      });
    } catch (error) {
      setPasswordMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function signOut(scope: 'here' | 'everywhere') {
    setSigningOut(scope);
    try {
      await apiFetch(scope === 'here' ? '/auth/logout' : '/auth/logout-all', { method: 'POST' });
      await clearAllOfflineData();
    } finally {
      router.replace(portalPath(slug, '/sign-in'));
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PortalHeading icon={<UserIcon className="size-6" />} title="My profile" />

      <OfflineCard slug={slug} organisationId={home.organisation.id} userId={user.id} />

      <Panel title="Your details">
        <dl className="grid gap-3 text-base sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-slate-600">Email address</dt>
          <dd className="break-all text-slate-900">{user.email}</dd>
          <dt className="font-medium text-slate-600">Organisation</dt>
          <dd className="text-slate-900">{home.organisation.name}</dd>
          <dt className="font-medium text-slate-600">Your role</dt>
          <dd className="text-slate-900">{home.you.roleLabel}</dd>
        </dl>
        <form method="post" onSubmit={saveName} className="mt-5 space-y-3" aria-label="Change your name">
          <label className="block text-base font-medium text-slate-900">
            Your name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              autoComplete="name"
              className={FIELD}
            />
          </label>
          {nameMessage && <Notice tone={nameMessage.tone}>{nameMessage.text}</Notice>}
          <PortalButton type="submit" busy={nameBusy} disabled={name.trim() === user.displayName}>
            Save name
          </PortalButton>
        </form>
      </Panel>

      <Panel
        title="Change password"
        description="Use at least 12 characters. A short sentence you can remember works well."
      >
        <form method="post" onSubmit={changePassword} className="space-y-4" aria-label="Change password">
          <label className="block text-base font-medium text-slate-900">
            Current password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="block text-base font-medium text-slate-900">
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={FIELD}
            />
          </label>
          {passwordMessage && <Notice tone={passwordMessage.tone}>{passwordMessage.text}</Notice>}
          <PortalButton type="submit" busy={passwordBusy}>
            Change password
          </PortalButton>
        </form>
      </Panel>

      {/* Shown only to Owners and Administrators (the API decides). */}
      <TwoStepCard
        look={PORTAL_LOOK}
        wrap={({ title, description, children }) => (
          <Panel title={title} description={description}>
            {children}
          </Panel>
        )}
      />

      <Panel title="Sign out">
        <div className="flex flex-col gap-3 sm:flex-row">
          <PortalButton
            variant="secondary"
            busy={signingOut === 'here'}
            onClick={() => signOut('here')}
          >
            Sign out
          </PortalButton>
          <PortalButton
            variant="quiet"
            busy={signingOut === 'everywhere'}
            onClick={() => signOut('everywhere')}
          >
            Sign out on all devices
          </PortalButton>
        </div>
      </Panel>
    </div>
  );
}
