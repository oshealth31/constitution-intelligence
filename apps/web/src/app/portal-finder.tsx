'use client';

import { useState, type FormEvent } from 'react';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Lets someone type their organisation's portal address (e.g. "riverside-choir") and go there. */
export function PortalFinder() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Accept a full link too: keep only the part after "/o/".
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/^.*\/o\//, '')
      .replace(/[/?#].*$/, '');
    if (!SLUG.test(slug)) {
      setError('Please type the portal address your organisation gave you, e.g. riverside-choir.');
      return;
    }
    window.location.assign(`/o/${slug}`);
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 rounded-2xl border border-teal-100 bg-white p-5" aria-label="Open your organisation’s portal">
      <label htmlFor="portal-address" className="block text-base font-semibold text-navy-900">
        Open your organisation’s portal
      </label>
      <p className="mt-1 text-sm text-muted">Type the portal address your organisation gave you.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id="portal-address"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="e.g. riverside-choir"
          autoCapitalize="none"
          spellCheck={false}
          className="min-h-12 flex-1 rounded-xl border border-slate-300 px-4 text-base focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 focus:outline-none"
        />
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-navy-900 px-5 text-base font-semibold text-ivory-50 hover:bg-navy-700"
        >
          Open portal
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-800">
          {error}
        </p>
      )}
    </form>
  );
}
