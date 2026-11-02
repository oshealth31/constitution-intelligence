'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Loading } from '@/components/ui';
import { ApiError, apiFetch, type CurrentUser } from '@/lib/api';
import { brand } from '@/lib/brand';
import { ConsoleUserContext, type ConsoleUser } from './console-context';

const NAVIGATION = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/organisations', label: 'Organisations' },
  { href: '/admin/support', label: 'Support' },
  { href: '/admin/audit', label: 'Audit log' },
  { href: '/admin/health', label: 'System health' },
];

type GateState =
  | { kind: 'loading' }
  | { kind: 'allowed'; user: ConsoleUser }
  | { kind: 'forbidden'; user: ConsoleUser }
  | { kind: 'error' };

/**
 * Control centre shell. The page checks who is signed in only to choose what to SHOW;
 * every piece of data is protected by the API, which refuses anyone who is not a
 * Platform Super Admin.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [gate, setGate] = useState<GateState>({ kind: 'loading' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CurrentUser>('/auth/me')
      .then((me) => {
        if (cancelled) return;
        if (!me.user) {
          router.replace('/admin/sign-in');
        } else if (me.user.isPlatformSuperAdmin) {
          setGate({ kind: 'allowed', user: me.user });
        } else {
          setGate({ kind: 'forbidden', user: me.user });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          router.replace('/admin/sign-in');
        } else {
          setGate({ kind: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/admin/sign-in');
    }
  }

  if (gate.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ivory-50">
        <Loading label="Checking your access…" />
      </div>
    );
  }
  if (gate.kind === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ivory-50 p-6 text-center text-sm text-muted">
        The control centre could not be reached. Please refresh the page.
      </div>
    );
  }
  if (gate.kind === 'forbidden') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ivory-50 px-4">
        <div className="max-w-md rounded-2xl border border-ivory-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-navy-900">This area is restricted</h1>
          <p className="mt-3 text-sm text-muted">
            The control centre is only available to Constitution Intelligence platform
            administrators. You are signed in as {gate.user.email}.
          </p>
          <Button variant="secondary" className="mt-6" busy={signingOut} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  const isActive = (href: string) =>
    href === '/admin'
      ? pathname === '/admin'
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <ConsoleUserContext.Provider value={gate.user}>
      <div className="min-h-dvh bg-ivory-50 lg:flex">
        <aside className="bg-navy-900 text-ivory-50 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col">
          <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-6 lg:py-6">
            <div>
              <p className="text-sm font-semibold tracking-tight">{brand.name}</p>
              <p className="text-[11px] font-medium tracking-[0.18em] text-teal-500 uppercase">
                Control centre
              </p>
            </div>
          </div>
          <nav
            aria-label="Control centre"
            className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0"
          >
            {NAVIGATION.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                  isActive(item.href)
                    ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--color-teal-500)]'
                    : 'text-ivory-100/80 hover:bg-white/5 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden border-t border-white/10 px-6 py-5 lg:block">
            <p className="truncate text-sm font-medium">{gate.user.displayName}</p>
            <p className="truncate text-xs text-ivory-100/60">{gate.user.email}</p>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="mt-3 text-xs font-medium text-teal-500 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-end border-b border-ivory-100 bg-white px-4 py-2 lg:hidden">
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="text-xs font-medium text-navy-900"
            >
              Sign out ({gate.user.email})
            </button>
          </div>
          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            {children}
          </main>
        </div>
      </div>
    </ConsoleUserContext.Provider>
  );
}
