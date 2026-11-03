'use client';

import { useCallback, useEffect, useState } from 'react';
import { Notice, Panel, PortalButton } from '@/components/portal-ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { freshness, type OfflineCopy } from '@/lib/offline';
import { deleteCopy, getCopy } from '@/lib/offline-store';
import { syncOfflineCopy, type SyncResult } from '@/lib/offline-sync';
import { useOnline } from '@/lib/use-online';

/** Registers the service worker that lets the offline reader open without a network. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline reading is an extra; the portal works without it.
    });
  }, []);
  return null;
}

/** The saved copy for a portal on this device (null when none), refreshed on demand. */
export function useOfflineCopy(slug: string) {
  const [copy, setCopy] = useState<OfflineCopy | null | undefined>(undefined);
  const reload = useCallback(async () => setCopy(await getCopy(slug)), [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { copy, setCopy, reload };
}

/** Always visible while offline, so nobody mistakes old content for live content. */
export function ConnectionBanner({ slug }: { slug: string }) {
  const online = useOnline();
  const { copy, reload } = useOfflineCopy(slug);
  useEffect(() => {
    if (!online) void reload();
  }, [online, reload]);
  if (online) return null;
  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-950"
    >
      <strong>You are offline.</strong> Pages that need the internet — including AI answers — will
      not load until the connection returns.
      {copy && (
        <>
          {' '}
          <a href={`/offline/${slug}`} className="font-medium underline underline-offset-4">
            Read the copy saved on {formatDate(copy.syncedAt)}
          </a>
        </>
      )}
    </div>
  );
}

/**
 * Keeps a saved copy up to date while online: on opening the portal and whenever the
 * connection comes back. Does nothing if the person has not chosen to save a copy.
 */
export function OfflineSyncer({
  slug,
  organisationId,
  userId,
}: {
  slug: string;
  organisationId: string;
  userId: string;
}) {
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (cancelled || !(await getCopy(slug))) return;
      await syncOfflineCopy(slug, organisationId, userId);
    };
    void sync();
    window.addEventListener('online', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('online', sync);
    };
  }, [slug, organisationId, userId]);
  return null;
}

function resultMessage(
  result: SyncResult,
): { tone: 'success' | 'warning' | 'error'; text: string } | null {
  switch (result.kind) {
    case 'updated':
      return {
        tone: 'success',
        text: 'Saved. You can now read the constitution without the internet.',
      };
    case 'current':
      return { tone: 'success', text: 'Your saved copy is up to date.' };
    case 'removed':
      return { tone: 'warning', text: result.reason };
    case 'signed_out':
      return { tone: 'warning', text: 'Please sign in again to update the saved copy.' };
    case 'offline':
      return { tone: 'warning', text: 'You are offline. Try again when you are connected.' };
    case 'failed':
      return { tone: 'error', text: result.message };
  }
}

/** "Read without internet": save, update, open or remove this device's copy. */
export function OfflineCard({
  slug,
  organisationId,
  userId,
}: {
  slug: string;
  organisationId: string;
  userId: string;
}) {
  const online = useOnline();
  const { copy, setCopy, reload } = useOfflineCopy(slug);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [message, setMessage] = useState<ReturnType<typeof resultMessage>>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function save(force: boolean) {
    setBusy('save');
    setMessage(null);
    const result = await syncOfflineCopy(slug, organisationId, userId, { force });
    setMessage(resultMessage(result));
    await reload();
    setBusy(null);
  }

  async function remove() {
    setBusy('remove');
    await deleteCopy(slug);
    setCopy(null);
    setConfirmRemove(false);
    setMessage({ tone: 'success', text: 'The saved copy has been removed from this device.' });
    setBusy(null);
  }

  if (copy === undefined) return null;
  const state = copy ? freshness(copy) : null;
  const versions = copy?.bundle.constitutions ?? [];

  return (
    <Panel
      title="Read without internet"
      description="Keep a copy of the approved constitution on this device, to read and search it when you are offline."
    >
      <div aria-label="Offline reading" className="space-y-3">
        {!copy ? (
          <>
            <p className="text-base text-slate-700">
              Only the current approved constitution is saved (and its approved simple words) — no
              names, contact details, questions or drafts. Do not save it on a shared or public
              computer. Signing out removes it.
            </p>
            <PortalButton busy={busy === 'save'} disabled={!online} onClick={() => void save(true)}>
              Save for offline reading
            </PortalButton>
          </>
        ) : (
          <>
            <p data-testid="offline-saved" className="text-base text-slate-800">
              Saved on this device · last synchronised {formatDateTime(copy.syncedAt)}.
            </p>
            <ul className="text-sm text-slate-600">
              {versions.map((constitution) => (
                <li key={constitution.id}>
                  {constitution.title} — Version {constitution.version.versionNumber}:{' '}
                  {constitution.version.label}
                </li>
              ))}
            </ul>
            {state?.kind === 'stale' && (
              <Notice tone="warning">
                Not synchronised for {state.days} days. The saved copy may be out of date.
              </Notice>
            )}
            {state?.kind === 'expired' && (
              <Notice tone="warning">
                The saved copy has expired. Update it to keep reading offline.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <a
                href={`/offline/${slug}`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-5 py-3 text-base font-semibold text-[var(--brand-on-primary)]"
              >
                Open the saved copy
              </a>
              <PortalButton
                variant="secondary"
                busy={busy === 'save'}
                disabled={!online}
                onClick={() => void save(false)}
              >
                Update now
              </PortalButton>
              {confirmRemove ? (
                <>
                  <PortalButton
                    variant="secondary"
                    busy={busy === 'remove'}
                    onClick={() => void remove()}
                  >
                    Yes, remove it
                  </PortalButton>
                  <PortalButton variant="quiet" onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </PortalButton>
                </>
              ) : (
                <PortalButton variant="quiet" onClick={() => setConfirmRemove(true)}>
                  Remove from this device
                </PortalButton>
              )}
            </div>
          </>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </Panel>
  );
}
