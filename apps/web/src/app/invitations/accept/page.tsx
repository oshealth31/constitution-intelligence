'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Loading, TextField } from '@/components/ui';
import { ApiError, apiFetch, describeError } from '@/lib/api';
import { brand } from '@/lib/brand';

/**
 * The page an invitation email links to: /invitations/accept?token=…
 * A new person chooses their name and password here; their account is created and they are
 * signed in, then taken to their organisation's portal. Someone who already has an account
 * signs in first and accepts with one button.
 */

interface AcceptResult {
  organisationId: string;
  organisationSlug: string;
  role: string;
}

type Problem =
  | { kind: 'message'; text: string }
  | { kind: 'has-account'; text: string }
  | { kind: 'other-account'; text: string };

function problemFrom(caught: unknown): Problem {
  if (caught instanceof ApiError && caught.status === 401) {
    return { kind: 'has-account', text: caught.message };
  }
  if (caught instanceof ApiError && caught.status === 403 && /different email/i.test(caught.message)) {
    return { kind: 'other-account', text: caught.message };
  }
  return { kind: 'message', text: describeError(caught) };
}

function AcceptInvitationForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function accept(body: Record<string, string>) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await apiFetch<AcceptResult>('/invitations/accept', {
        method: 'POST',
        body: { token, ...body },
      });
      const portal = `/o/${encodeURIComponent(result.organisationSlug)}`;
      setDone(portal);
      router.push(portal);
    } catch (caught) {
      setProblem(problemFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setProblem({ kind: 'message', text: 'The two passwords do not match.' });
      return;
    }
    await accept({ displayName: displayName.trim(), password });
  }

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      setProblem(null);
    } catch (caught) {
      setProblem({ kind: 'message', text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Alert>This link is incomplete. Please open the full link from your invitation email.</Alert>
    );
  }
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="good">Welcome! Your invitation has been accepted.</Alert>
        <Link href={done} className="text-sm font-medium text-teal-600 underline">
          Go to your organisation
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {problem?.kind === 'message' && <Alert>{problem.text}</Alert>}
      {problem?.kind === 'other-account' && (
        <div className="space-y-3">
          <Alert>
            You are signed in with a different account on this device. Sign out, then accept the
            invitation with the details below.
          </Alert>
          <Button type="button" variant="secondary" busy={busy} onClick={signOut}>
            Sign out
          </Button>
        </div>
      )}
      {problem?.kind === 'has-account' && (
        <div className="space-y-3">
          <Alert>
            You already have an account with this email address. Sign in on your organisation&apos;s
            page with that account, then open the invitation link again and choose &quot;I already
            have an account&quot;.
          </Alert>
        </div>
      )}

      <form method="post" onSubmit={onSubmit} className="space-y-5" aria-label="Create your account">
        <p className="text-sm text-navy-700">
          Choose your name and a password to create your account and join your organisation.
        </p>
        <TextField
          label="Your full name"
          autoComplete="name"
          required
          maxLength={120}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters. A short sentence works well."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Button type="submit" busy={busy} className="w-full">
          Create account and join
        </Button>
      </form>

      <div className="border-t border-ivory-100 pt-4">
        <p className="mb-2 text-sm text-navy-700">Already have an account and signed in?</p>
        <Button type="button" variant="secondary" busy={busy} onClick={() => accept({})}>
          I already have an account
        </Button>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ivory-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-ivory-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-teal-600 uppercase">
          {brand.name}
        </p>
        <h1 className="mt-2 mb-6 text-xl font-semibold text-navy-900">Accept your invitation</h1>
        <Suspense fallback={<Loading />}>
          <AcceptInvitationForm />
        </Suspense>
      </div>
    </main>
  );
}
