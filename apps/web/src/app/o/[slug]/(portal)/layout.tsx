'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BookIcon,
  ChatIcon,
  HomeIcon,
  OrganisationLogo,
  PortalButton,
  PortalLoading,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from '@/components/portal-ui';
import { ApiError, apiFetch, type CurrentUser } from '@/lib/api';
import { brand } from '@/lib/brand';
import { BrandScope } from '@/components/brand-scope';
import { canManage, portalPath, type AiStatus, type PortalHome } from '@/lib/portal';
import {
  ConnectionBanner,
  OfflineSyncer,
  ServiceWorkerRegistration,
  useOfflineCopy,
} from '@/components/offline-ui';
import { formatDate } from '@/lib/format';
import { clearAllOfflineData } from '@/lib/offline-store';
import { usePublicPortal } from '../public-portal-context';
import { PortalSessionContext, type PortalSession } from './portal-context';

type Gate =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'no-access'; email: string }
  | { kind: 'ready'; session: Omit<PortalSession, 'reload'> };

/**
 * The signed-in part of a portal. It checks who is signed in and that they belong to THIS
 * organisation, then shows the organisation's own look. This check only decides what to show:
 * the API refuses every request from anyone who is not a member, whatever the page does.
 */
export default function SignedInPortalLayout({ children }: { children: ReactNode }) {
  const publicPortal = usePublicPortal();
  const slug = publicPortal.slug;
  const router = useRouter();
  const pathname = usePathname();
  const [gate, setGate] = useState<Gate>({ kind: 'loading' });
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await apiFetch<CurrentUser>('/auth/me');
      if (!me.user) {
        router.replace(portalPath(slug, '/sign-in'));
        return;
      }
      const membership = me.memberships.find((item) => item.organisationSlug === slug);
      if (!membership) {
        setGate({ kind: 'no-access', email: me.user.email });
        return;
      }
      const api = `/organisations/${membership.organisationId}`;
      const [home, aiAvailable] = await Promise.all([
        apiFetch<PortalHome>(`${api}/portal`),
        // Only decides which version of the question page to offer; the API enforces the rest.
        apiFetch<AiStatus>(`${api}/ai/status`).then(
          (status) => status.available,
          () => false,
        ),
      ]);
      setGate({
        kind: 'ready',
        session: {
          slug,
          organisationId: membership.organisationId,
          home,
          user: me.user,
          api,
          aiAvailable,
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace(portalPath(slug, '/sign-in'));
      } else if (error instanceof ApiError && error.status === 404) {
        setGate({ kind: 'no-access', email: '' });
      } else {
        setGate({ kind: 'error' });
      }
    }
  }, [router, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      // Signing out also removes anything saved on this device for offline reading.
      await clearAllOfflineData();
    } finally {
      router.replace(portalPath(slug, '/sign-in'));
    }
  }

  if (gate.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PortalLoading label="Checking your access…" />
      </div>
    );
  }
  if (gate.kind === 'error') {
    return <Unreachable slug={slug} />;
  }
  if (gate.kind === 'no-access') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <OrganisationLogo name={publicPortal.name} logoUrl={publicPortal.logoUrl} size={56} />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">
            You are not a member of {publicPortal.name}
          </h1>
          <p className="mt-3 text-base text-slate-600">
            {gate.email ? `You are signed in as ${gate.email}. ` : ''}
            This portal is only for members of {publicPortal.name}. If you think this is a mistake,
            please ask the organisation to invite you.
          </p>
          <PortalButton variant="secondary" className="mt-6" busy={signingOut} onClick={signOut}>
            Sign out
          </PortalButton>
        </div>
      </main>
    );
  }

  const { session } = gate;
  const { home } = session;
  // Colours from the signed-in settings (the freshest copy, e.g. just after an administrator saves).
  const colours = home.organisation.colours;
  const navigation = [
    { href: portalPath(slug), label: 'Home', short: 'Home', icon: HomeIcon, exact: true },
    { href: portalPath(slug, '/library'), label: 'Read', short: 'Read', icon: BookIcon },
    { href: portalPath(slug, '/search'), label: 'Search', short: 'Search', icon: SearchIcon },
    // With AI switched off, the same page finds matching clauses instead of answering.
    session.aiAvailable
      ? { href: portalPath(slug, '/ask'), label: 'Ask', short: 'Ask', icon: ChatIcon }
      : { href: portalPath(slug, '/ask'), label: 'Find clauses', short: 'Clauses', icon: ChatIcon },
    ...(canManage(home.you.permissions)
      ? [
          {
            href: portalPath(slug, '/manage'),
            label: 'Manage',
            short: 'Manage',
            icon: SettingsIcon,
          },
        ]
      : []),
    { href: portalPath(slug, '/profile'), label: 'My profile', short: 'Profile', icon: UserIcon },
  ];
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  // The reader page counts as "Read".
  const activeHref =
    navigation.find((item) => isActive(item.href, item.exact))?.href ??
    (pathname.includes('/read/') ? portalPath(slug, '/library') : undefined);

  return (
    <PortalSessionContext.Provider value={{ ...session, reload: load }}>
      <BrandScope colours={colours} className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2"
        >
          Skip to main content
        </a>
        <header className="sticky top-0 z-30 bg-[var(--brand-primary)] text-[var(--brand-on-primary)] shadow-sm">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href={portalPath(slug)} className="flex min-w-0 items-center gap-3">
              <OrganisationLogo
                name={home.organisation.name}
                logoUrl={home.organisation.logoUrl}
                size={40}
              />
              <span className="truncate text-lg font-semibold tracking-tight">
                {home.organisation.name}
              </span>
            </Link>
            <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={activeHref === item.href ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2 text-base font-medium transition ${
                    activeHref === item.href
                      ? 'bg-black/15 shadow-[inset_0_-3px_0_var(--brand-accent)]'
                      : 'opacity-90 hover:bg-black/10 hover:opacity-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="h-1 bg-[var(--brand-accent)]" />
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 focus:outline-none sm:px-6 md:pb-12"
        >
          <ServiceWorkerRegistration />
          <OfflineSyncer
            slug={slug}
            organisationId={session.organisationId}
            userId={session.user.id}
          />
          <ConnectionBanner slug={slug} />
          <SubscriptionNotice
            slug={slug}
            home={home}
            onBillingPage={pathname.endsWith('/manage/subscription')}
          >
            {children}
          </SubscriptionNotice>
        </main>

        <footer className="hidden pb-8 text-center text-xs text-slate-500 md:block">
          {home.organisation.legalName} · Powered by {brand.name}
        </footer>

        {/* Phones and small tablets: large, labelled buttons at the bottom of the screen. */}
        <nav
          aria-label="Main (bottom)"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,0.08)] md:hidden"
        >
          <ul className="mx-auto flex max-w-xl">
            {navigation.map((item) => {
              const active = activeHref === item.href;
              const ItemIcon = item.icon;
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold ${
                      active ? 'text-[var(--brand-ink)]' : 'text-slate-600'
                    }`}
                  >
                    {active && (
                      <span className="absolute inset-x-3 top-0 h-1 rounded-b bg-[var(--brand-accent)]" />
                    )}
                    <ItemIcon className="size-6" />
                    {item.short}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </BrandScope>
    </PortalSessionContext.Provider>
  );
}

/**
 * Explains the subscription when it is not simply active. The API refuses whatever the
 * subscription does not allow; this only saves people from a page of errors.
 */
function SubscriptionNotice({
  slug,
  home,
  onBillingPage,
  children,
}: {
  slug: string;
  home: PortalHome;
  onBillingPage: boolean;
  children: ReactNode;
}) {
  const subscription = home.subscription;
  if (!subscription || subscription.state === 'pilot' || subscription.state === 'active') {
    return <>{children}</>;
  }
  const isAdmin = home.you.role === 'owner' || home.you.role === 'admin';
  const blocked = !subscription.fullAccess && !(subscription.readOnly && isAdmin);
  const canSeeBilling = home.you.permissions.includes('billing.read');
  const banner = (
    <div
      role="status"
      className={`mb-5 rounded-xl border px-4 py-3 text-base ${
        subscription.state === 'grace'
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-rose-300 bg-rose-50 text-rose-950'
      }`}
    >
      <p data-testid="subscription-notice">{subscription.message}</p>
      {canSeeBilling && !onBillingPage && (
        <Link
          href={portalPath(slug, '/manage/subscription')}
          className="mt-1 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          See the subscription and invoices
        </Link>
      )}
    </div>
  );
  if (blocked && !onBillingPage) {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-4 text-2xl font-bold text-slate-900">
          The portal is not available right now
        </h1>
        {banner}
        {!canSeeBilling && (
          <p className="text-base text-slate-700">
            Please speak to your organisation’s owner or committee.
          </p>
        )}
      </div>
    );
  }
  return (
    <>
      {banner}
      {children}
    </>
  );
}

/** The portal could not be loaded (usually no connection): offer this device's saved copy. */
function Unreachable({ slug }: { slug: string }) {
  const { copy } = useOfflineCopy(slug);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-base text-slate-600">
      <p>The portal could not be reached. Please check your connection and refresh the page.</p>
      {copy && (
        <a
          href={`/offline/${slug}`}
          className="inline-flex min-h-12 items-center rounded-xl bg-[#0b1f3a] px-5 py-3 font-semibold text-white"
        >
          Read the copy saved on {formatDate(copy.syncedAt)}
        </a>
      )}
    </div>
  );
}
