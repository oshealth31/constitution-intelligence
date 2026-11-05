'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PortalLoading } from '@/components/portal-ui';
import { ApiError, apiFetch } from '@/lib/api';
import { brand } from '@/lib/brand';
import { BrandScope } from '@/components/brand-scope';
import type { PublicPortal } from '@/lib/portal';
import { PublicPortalContext } from './public-portal-context';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; portal: PublicPortal };

/**
 * Every organisation portal (/o/<portal address>/...) starts here. The organisation's colours
 * and logo are loaded from its settings each time, so all organisations share this one code base.
 */
export default function OrganisationPortalLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    apiFetch<PublicPortal>(`/portal/${encodeURIComponent(slug)}`)
      .then((portal) => {
        if (!cancelled) setState({ kind: 'ready', portal });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { kind: 'missing' }
            : { kind: 'error' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (state.kind === 'ready') {
      document.title = `${state.portal.name} · ${brand.name}`;
    }
  }, [state]);

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ivory-50">
        <PortalLoading label="Opening your organisation’s portal…" />
      </div>
    );
  }
  if (state.kind !== 'ready') {
    return (
      <PlainMessage
        title={
          state.kind === 'missing'
            ? 'We could not find this portal'
            : 'The portal could not be reached'
        }
      >
        {state.kind === 'missing'
          ? 'Please check the web address your organisation gave you. It usually looks like /o/your-organisation.'
          : 'Please check your internet connection and refresh the page.'}
      </PlainMessage>
    );
  }
  if (!state.portal.available) {
    return (
      <PlainMessage title={`${state.portal.name} is temporarily unavailable`}>
        This portal has been paused. Please contact your organisation’s committee for more
        information.
      </PlainMessage>
    );
  }
  return (
    <PublicPortalContext.Provider value={state.portal}>
      <BrandScope colours={state.portal.colours} className="min-h-dvh bg-slate-50 text-slate-900">
        {children}
      </BrandScope>
    </PublicPortalContext.Provider>
  );
}

function PlainMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ivory-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-ivory-100 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
        <p className="mt-3 text-base text-muted">{children}</p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center text-base font-medium text-teal-600 underline underline-offset-4"
        >
          Go to {brand.name}
        </Link>
      </div>
    </main>
  );
}
