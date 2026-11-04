'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, TextField } from '@/components/ui';
import { CONSOLE_LOOK, TwoStepSignIn } from '@/components/two-step';
import { apiFetch, describeError, type LoginResponse } from '@/lib/api';
import { brand } from '@/lib/brand';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the password was right and a two-step code is needed.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      if (result.twoStepRequired) {
        setChallengeToken(result.challengeToken);
        setPassword('');
        setBusy(false);
        return;
      }
      router.replace('/admin');
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-teal-500 uppercase">
            Control centre
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-ivory-50">{brand.name}</h1>
          <p className="mt-2 text-sm text-ivory-100/70">{brand.tagline}</p>
        </div>
        {challengeToken ? (
          <div className="rounded-2xl bg-white p-6 shadow-xl sm:p-8">
            <TwoStepSignIn
              challengeToken={challengeToken}
              look={CONSOLE_LOOK}
              onSignedIn={() => router.replace('/admin')}
              onStartAgain={() => setChallengeToken(null)}
            />
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-5 rounded-2xl bg-white p-6 shadow-xl sm:p-8"
            aria-label="Sign in"
          >
            <h2 className="text-lg font-semibold text-navy-900">Sign in</h2>
            {error && <Alert>{error}</Alert>}
            <TextField
              label="Email address"
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" busy={busy} className="w-full">
              Sign in
            </Button>
            <p className="text-center text-xs text-muted">
              Restricted to authorised Constitution Intelligence staff. All access is recorded.
            </p>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-ivory-100/70">
          <Link
            href="/forgot-password"
            className="underline underline-offset-4 hover:text-ivory-50"
          >
            Forgotten your password?
          </Link>
        </p>
      </div>
    </main>
  );
}
