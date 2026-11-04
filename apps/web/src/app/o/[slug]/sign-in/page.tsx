'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Notice, OrganisationLogo, PortalButton } from '@/components/portal-ui';
import { PORTAL_LOOK, TwoStepSignIn } from '@/components/two-step';
import { apiFetch, describeError, type LoginResponse } from '@/lib/api';
import { brand } from '@/lib/brand';
import { portalPath } from '@/lib/portal';
import { usePublicPortal } from '../public-portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

/** Branded sign-in page for one organisation's portal. */
export default function PortalSignInPage() {
  const portal = usePublicPortal();
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
      router.replace(portalPath(portal.slug));
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="bg-[var(--brand-primary)] px-4 pt-10 pb-16 text-center text-[var(--brand-on-primary)]">
        <div className="mx-auto flex max-w-md flex-col items-center">
          <OrganisationLogo name={portal.name} logoUrl={portal.logoUrl} size={72} />
          <p className="mt-4 text-2xl font-bold tracking-tight">{portal.name}</p>
          {portal.tagline && <p className="mt-1 text-base opacity-90">{portal.tagline}</p>}
        </div>
      </header>
      <div className="h-1.5 bg-[var(--brand-accent)]" />
      <div className="-mt-10 flex flex-1 justify-center px-4 pb-12">
        {challengeToken ? (
          <div className="h-fit w-full max-w-md rounded-2xl bg-white p-6 shadow-xl sm:p-8">
            <TwoStepSignIn
              challengeToken={challengeToken}
              look={PORTAL_LOOK}
              onSignedIn={() => router.replace(portalPath(portal.slug))}
              onStartAgain={() => setChallengeToken(null)}
            />
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            aria-label="Sign in"
            className="h-fit w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-xl sm:p-8"
          >
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
              <p className="mt-1 text-base text-slate-600">
                Use the email address and password for your {portal.name} account.
              </p>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <label className="block text-base font-medium text-slate-900">
              Email address
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block text-base font-medium text-slate-900">
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={FIELD}
              />
            </label>
            <PortalButton type="submit" busy={busy} className="w-full">
              Sign in
            </PortalButton>
            <p className="text-center text-base">
              <Link
                href="/forgot-password"
                className="font-medium text-[var(--brand-ink)] underline underline-offset-4"
              >
                Forgotten your password?
              </Link>
            </p>
          </form>
        )}
      </div>
      <footer className="px-4 pb-6 text-center text-xs text-slate-500">
        Powered by {brand.name}
      </footer>
    </main>
  );
}
