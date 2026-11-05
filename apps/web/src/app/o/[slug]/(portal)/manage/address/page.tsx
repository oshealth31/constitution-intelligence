'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Notice, Panel, PortalButton, PortalField } from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { portalPath } from '@/lib/portal';
import { usePortal } from '../../portal-context';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Changing the portal address (owners only; the API enforces this). */
export default function PortalAddressPage() {
  const { api, slug } = usePortal();
  const [value, setValue] = useState(slug);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const next = value.trim().toLowerCase();
  const valid = SLUG.test(next);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ slug: string }>(`${api}/settings`, {
        method: 'PATCH',
        body: { slug: next },
      });
      // A full page load, so the portal reloads under its new address.
      window.location.assign(portalPath(result.slug, '/manage/address'));
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Portal address"
      description="This is the link members use to open your portal. If you change it, the old link stops working, so tell your members the new one."
    >
      <p className="text-base text-slate-800">
        Current address:{' '}
        <strong className="break-all">
          {origin}
          {portalPath(slug)}
        </strong>
      </p>
      <form
        method="post"
        onSubmit={save}
        className="mt-5 space-y-4"
        aria-label="Change portal address"
      >
        <PortalField
          label={<>New address</>}
          hint={<>3 to 50 lower-case letters, numbers or hyphens, for example “riverside-choir”.</>}
        >
          {(field) => (
            <>
              <span className="mt-2 flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm focus-within:ring-2 focus-within:ring-[var(--brand-accent)]">
                <span className="flex items-center bg-slate-100 px-3 text-base text-slate-600">
                  /o/
                </span>
                <input
                  {...field}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setConfirmed(false);
                  }}
                  maxLength={50}
                  autoCapitalize="none"
                  spellCheck={false}
                  className="min-h-12 w-full px-3 text-base focus:outline-none"
                />
              </span>
            </>
          )}
        </PortalField>
        {!valid && value && (
          <Notice tone="warning">
            Use only lower-case letters, numbers and hyphens (3 to 50).
          </Notice>
        )}
        <label className="flex items-start gap-3 text-base text-slate-800">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 size-5"
          />
          I understand that the old link will stop working.
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <PortalButton type="submit" busy={busy} disabled={!valid || !confirmed || next === slug}>
          Change address
        </PortalButton>
      </form>
    </Panel>
  );
}
