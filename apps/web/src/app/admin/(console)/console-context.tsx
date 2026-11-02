'use client';

import { createContext, useContext } from 'react';
import type { CurrentUser } from '@/lib/api';

export type ConsoleUser = NonNullable<CurrentUser['user']>;

export const ConsoleUserContext = createContext<ConsoleUser | null>(null);

/** The signed-in Platform Super Admin (only available inside the control centre). */
export function useConsoleUser(): ConsoleUser {
  const user = useContext(ConsoleUserContext);
  if (!user) {
    throw new Error('useConsoleUser must be used inside the control centre layout');
  }
  return user;
}
