'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T) => void;
}

/** Loads `path` from the API when the component mounts (and whenever `path` changes). */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState<boolean>(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    setError(undefined);
    try {
      setData(await apiFetch<T>(path));
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
