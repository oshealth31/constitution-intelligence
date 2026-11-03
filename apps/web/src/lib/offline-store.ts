'use client';

/**
 * Where this device keeps copies for offline reading: the browser's IndexedDB, one record per
 * portal. Only published constitution content and dates are stored (see OfflineBundle) — never
 * passwords, session cookies or tokens (the session cookie is HttpOnly and cannot be read here).
 */
import { isOfflineBundle, type OfflineCopy } from './offline';

const DB_NAME = 'ci-offline';
const STORE = 'copies';

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'slug' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Offline storage is not available.'));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage failed.'));
    });
  } finally {
    db.close();
  }
}

export async function getCopy(slug: string): Promise<OfflineCopy | null> {
  if (!available()) return null;
  try {
    const copy = (await run('readonly', (store) => store.get(slug))) as OfflineCopy | undefined;
    // Anything that is not a well-formed copy (older format, damaged) is treated as absent.
    return copy && isOfflineBundle(copy.bundle) ? copy : null;
  } catch {
    return null;
  }
}

export async function saveCopy(copy: OfflineCopy): Promise<void> {
  await run('readwrite', (store) => store.put(copy));
}

export async function listCopies(): Promise<OfflineCopy[]> {
  if (!available()) return [];
  try {
    return ((await run('readonly', (store) => store.getAll())) as OfflineCopy[]).filter((copy) =>
      isOfflineBundle(copy.bundle),
    );
  } catch {
    return [];
  }
}

/** Removes one portal's copy (content and the saved reader page). */
export async function deleteCopy(slug: string): Promise<void> {
  if (available()) {
    try {
      await run('readwrite', (store) => store.delete(slug));
    } catch {
      // Nothing stored.
    }
  }
  await tellServiceWorker({ type: 'clear-offline', slug }, false);
}

/** Removes everything this app saved on the device for offline use. */
export async function clearAllOfflineData(): Promise<void> {
  if (available()) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  if (typeof caches !== 'undefined') {
    for (const key of await caches.keys()) {
      if (key.startsWith('ci-offline-pages-')) await caches.delete(key);
    }
  }
  await tellServiceWorker({ type: 'clear-offline' }, false);
}

/** Sends a message to the service worker and waits briefly for its answer. */
export async function tellServiceWorker(
  message: Record<string, unknown>,
  waitForWorker = true,
): Promise<{ ok: boolean } | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  // On a first visit the worker may still be starting: wait for it (briefly).
  const registration = waitForWorker
    ? await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000)),
      ])
    : await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 15_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok: boolean }>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
