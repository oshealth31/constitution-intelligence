'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import { brand } from '@/lib/brand';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ message: string }>('/auth/password/forgot', {
        method: 'POST',
        body: { email },
      });
      setMessage(response.message);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ivory-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-ivory-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold tracking-[0.2em] text-teal-600 uppercase">
          {brand.name}
        </p>
        <h1 className="mt-2 mb-6 text-xl font-semibold text-navy-900">Reset your password</h1>
        {message ? (
          <Alert tone="good">{message}</Alert>
        ) : (
          <form method="post" onSubmit={onSubmit} className="space-y-5">
            {error && <Alert>{error}</Alert>}
            <TextField
              label="Email address"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" busy={busy} className="w-full">
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-6 text-sm">
          <Link href="/admin/sign-in" className="text-teal-600 underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
