'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the server-rendered page and while the page's code is still starting, true once it
 * runs (Task T1). Submit buttons stay disabled until then, so a form can never be sent the
 * browser's plain way (which, on a slow phone, would reload the page and lose what was typed).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
