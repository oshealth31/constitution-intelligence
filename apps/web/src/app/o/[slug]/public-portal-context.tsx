'use client';

import { createContext, useContext } from 'react';
import type { PublicPortal } from '@/lib/portal';

/** Public branding for the portal in the address bar (loaded before anyone signs in). */
export const PublicPortalContext = createContext<PublicPortal | null>(null);

export function usePublicPortal(): PublicPortal {
  const portal = useContext(PublicPortalContext);
  if (!portal) {
    throw new Error('usePublicPortal must be used inside an organisation portal.');
  }
  return portal;
}
