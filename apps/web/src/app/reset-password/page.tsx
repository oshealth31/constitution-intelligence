'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Loading, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import { brand } from '@/lib/brand';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/password/reset', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      setDone(true);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <Alert>This link is incomplete. Please use the full link from your email.</Alert>;
  }
  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="good">Your password has been set. You can now sign in.</Alert>
        <Link href="/admin/sign-in" className="text-sm font-medium text-teal-600 underline">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="space-y-5"
      aria-label="Choose a new password"
    >
      {error && <Alert>{error}</Alert>}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="At least 12 characters. A short sentence works well."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <Button type="submit" busy={busy} className="w-full">
        Set password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ivory-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-ivory-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-teal-600 uppercase">
          {brand.name}
        </p>
        <h1 className="mt-2 mb-6 text-xl font-semibold text-navy-900">Choose a new password</h1>
        <Suspense fallback={<Loading />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
