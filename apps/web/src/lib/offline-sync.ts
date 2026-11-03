'use client';

/**
 * Keeping a portal's offline copy up to date. Runs only while online and signed in:
 *  - asks the API whether the content changed (a small request); downloads it again if so;
 *  - a successful check extends how long the copy may be shown;
 *  - if the API says the person may no longer read the content (subscription suspended or
 *    restricted, membership removed), the copy is deleted from the device.
 */
import { ApiError, apiFetch } from './api';
import { isOfflineBundle, OFFLINE_FORMAT, type OfflineBundle, type OfflineCopy } from './offline';
import { deleteCopy, getCopy, saveCopy, tellServiceWorker } from './offline-store';

export type SyncResult =
  | { kind: 'updated'; copy: OfflineCopy }
  | { kind: 'current'; copy: OfflineCopy }
  | { kind: 'removed'; reason: string }
  | { kind: 'signed_out' }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string };

interface Status {
  format: number;
  contentHash: string;
  checkedAt: string;
  usableUntil: string;
}

const REMOVE_REASONS = new Set(['SUBSCRIPTION_INACTIVE', 'SUBSCRIPTION_READ_ONLY']);

/** Downloads (or refreshes) the copy for one portal. `organisationId` is from the signed-in session. */
export async function syncOfflineCopy(
  slug: string,
  organisationId: string,
  userId: string,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' };
  const api = `/organisations/${organisationId}/offline`;
  try {
    const existing = await getCopy(slug);
    const status = await apiFetch<Status>(`${api}/status`);
    if (
      !options.force &&
      existing &&
      existing.bundle.userId === userId &&
      existing.bundle.format === OFFLINE_FORMAT &&
      existing.bundle.contentHash === status.contentHash
    ) {
      const copy = { ...existing, syncedAt: status.checkedAt, usableUntil: status.usableUntil };
      await saveCopy(copy);
      return { kind: 'current', copy };
    }
    const bundle = await apiFetch<OfflineBundle>(`${api}/bundle`);
    if (!isOfflineBundle(bundle) || bundle.organisation.slug !== slug) {
      return { kind: 'failed', message: 'The downloaded content was not in the expected form.' };
    }
    const copy: OfflineCopy = {
      slug,
      bundle,
      syncedAt: bundle.generatedAt,
      usableUntil: bundle.usableUntil,
    };
    await saveCopy(copy);
    // Keep the offline reader page itself, so it opens without a network.
    await tellServiceWorker({ type: 'cache-offline-page', slug });
    return { kind: 'updated', copy };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { kind: 'signed_out' };
      if (error.status === 404 || (error.status === 403 && error.reason && REMOVE_REASONS.has(error.reason))) {
        await deleteCopy(slug);
        return {
          kind: 'removed',
          reason:
            error.status === 404
              ? 'You are no longer a member of this organisation, so its saved copy was removed from this device.'
              : 'Your organisation’s subscription is not active, so its saved copy was removed from this device.',
        };
      }
      return { kind: 'failed', message: error.message };
    }
    return { kind: 'offline' };
  }
}
