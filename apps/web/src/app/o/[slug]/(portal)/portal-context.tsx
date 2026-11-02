'use client';

import { createContext, useContext } from 'react';
import type { CurrentUser } from '@/lib/api';
import type { PortalHome } from '@/lib/portal';

export interface PortalSession {
  slug: string;
  organisationId: string;
  home: PortalHome;
  user: NonNullable<CurrentUser['user']>;
  /** Reloads branding and permissions (for example after an administrator changes them). */
  reload: () => Promise<void>;
  /** The base API path for this organisation: /organisations/<id> */
  api: string;
}

export const PortalSessionContext = createContext<PortalSession | null>(null);

export function usePortal(): PortalSession {
  const session = useContext(PortalSessionContext);
  if (!session) {
    throw new Error('usePortal must be used inside a signed-in organisation portal.');
  }
  return session;
}
