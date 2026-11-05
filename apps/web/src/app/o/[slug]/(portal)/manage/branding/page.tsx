'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ColourField } from '@/components/ui';
import {
  Notice,
  OrganisationLogo,
  Panel,
  PortalButton,
  PortalLoading,
} from '@/components/portal-ui';
import { apiFetch, describeError } from '@/lib/api';
import { colourWarnings, PLATFORM_COLOURS, safeColour } from '@/lib/branding';
import { BrandScope } from '@/components/brand-scope';
import { fileToBase64, LOGO_ACCEPT, LOGO_MAX_BYTES, type BrandingSettings } from '@/lib/portal';
import { useApi } from '@/lib/use-api';
import { usePortal } from '../../portal-context';

const FIELD =
  'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none';

type Message = { tone: 'success' | 'error'; text: string } | null;

/** Branding settings with a live preview. */
export default function BrandingPage() {
  const { api, home, reload } = usePortal();
  const branding = useApi<BrandingSettings>(`${api}/branding`);

  const [displayName, setDisplayName] = useState('');
  const [tagline, setTagline] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [primary, setPrimary] = useState<string>(PLATFORM_COLOURS.primary);
  const [secondary, setSecondary] = useState<string>(PLATFORM_COLOURS.secondary);
  const [accent, setAccent] = useState<string>(PLATFORM_COLOURS.accent);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const [uploading, setUploading] = useState(false);
  const [logoMessage, setLogoMessage] = useState<Message>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const data = branding.data;
    if (!data) return;
    setDisplayName(data.displayName ?? '');
    setTagline(data.tagline ?? '');
    setWelcomeMessage(data.welcomeMessage ?? '');
    setPrimary(safeColour(data.primaryColour, PLATFORM_COLOURS.primary));
    setSecondary(safeColour(data.secondaryColour, PLATFORM_COLOURS.secondary));
    setAccent(safeColour(data.accentColour, PLATFORM_COLOURS.accent));
  }, [branding.data]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<BrandingSettings>(`${api}/branding`, {
        method: 'PATCH',
        body: {
          displayName,
          tagline,
          welcomeMessage,
          primaryColour: primary,
          secondaryColour: secondary,
          accentColour: accent,
        },
      });
      branding.setData(updated);
      await reload();
      setMessage({
        tone: 'success',
        text: 'Branding saved. Everyone will see it next time they open the portal.',
      });
    } catch (error) {
      setMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoMessage(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoMessage({
        tone: 'error',
        text: 'Please choose a PNG, JPEG or WebP image. Other files, including SVG, are not accepted.',
      });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoMessage({ tone: 'error', text: 'The logo must be 512 KB or smaller.' });
      return;
    }
    setUploading(true);
    try {
      const updated = await apiFetch<BrandingSettings>(`${api}/branding/logo`, {
        method: 'PUT',
        body: { fileName: file.name, dataBase64: await fileToBase64(file) },
      });
      branding.setData(updated);
      await reload();
      setLogoMessage({ tone: 'success', text: 'Logo updated.' });
    } catch (error) {
      setLogoMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeLogo() {
    setUploading(true);
    setLogoMessage(null);
    try {
      const updated = await apiFetch<BrandingSettings>(`${api}/branding/logo`, {
        method: 'DELETE',
      });
      branding.setData(updated);
      await reload();
      setLogoMessage({ tone: 'success', text: 'Logo removed. Your initials are shown instead.' });
    } catch (error) {
      setLogoMessage({ tone: 'error', text: describeError(error) });
    } finally {
      setUploading(false);
    }
  }

  if (branding.loading && !branding.data) return <PortalLoading />;
  if (branding.error !== undefined && !branding.data) {
    return <Notice tone="error">{describeError(branding.error)}</Notice>;
  }

  const previewName =
    displayName.trim() || branding.data?.organisationName || home.organisation.name;
  const warnings = colourWarnings({ primary, secondary, accent });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem] [&>*]:min-w-0">
      <div className="space-y-5">
        <Panel
          title="Logo"
          description="PNG, JPEG or WebP, up to 512 KB. A square image works best."
        >
          <div className="flex flex-wrap items-center gap-4">
            <OrganisationLogo name={previewName} logoUrl={home.organisation.logoUrl} size={72} />
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-on-primary)] focus-within:ring-2 focus-within:ring-[var(--brand-accent)]">
                {uploading ? 'Uploading…' : 'Choose a logo'}
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO_ACCEPT}
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
              </label>
              {home.organisation.logoUrl && (
                <PortalButton variant="secondary" onClick={removeLogo} disabled={uploading}>
                  Remove logo
                </PortalButton>
              )}
            </div>
          </div>
          {logoMessage && (
            <div className="mt-4">
              <Notice tone={logoMessage.tone}>{logoMessage.text}</Notice>
            </div>
          )}
        </Panel>

        <Panel title="Name, colours and welcome message">
          <form method="post" onSubmit={save} className="space-y-5" aria-label="Branding">
            <label className="block text-base font-medium text-slate-900">
              Organisation name (as shown in the portal)
              <input
                value={displayName}
                maxLength={200}
                placeholder={branding.data?.organisationName}
                onChange={(event) => setDisplayName(event.target.value)}
                className={FIELD}
              />
              <span className="mt-1 block text-sm font-normal text-slate-600">
                Leave empty to use “{branding.data?.organisationName}”.
              </span>
            </label>
            <label className="block text-base font-medium text-slate-900">
              Short tagline (optional)
              <input
                value={tagline}
                maxLength={300}
                onChange={(event) => setTagline(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block text-base font-medium text-slate-900">
              Welcome message
              <textarea
                value={welcomeMessage}
                maxLength={1000}
                rows={4}
                onChange={(event) => setWelcomeMessage(event.target.value)}
                className={FIELD}
              />
              <span className="mt-1 block text-sm font-normal text-slate-600">
                Plain text only, up to 1,000 characters. It appears on the home page after members
                sign in.
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <ColourField label="Primary colour" value={primary} onChange={setPrimary} />
              <ColourField label="Secondary colour" value={secondary} onChange={setSecondary} />
              <ColourField label="Accent colour" value={accent} onChange={setAccent} />
            </div>
            <p className="text-sm text-slate-600">
              Primary: top bar and main buttons. Secondary: welcome panel and part headings. Accent:
              highlights and the selected menu item.
            </p>
            {warnings.length > 0 && (
              <Notice tone="warning">
                <ul className="list-disc space-y-1 pl-5">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <PortalButton type="submit" busy={saving}>
              Save branding
            </PortalButton>
          </form>
        </Panel>
      </div>

      <aside aria-label="Preview" className="lg:sticky lg:top-28 lg:self-start">
        <p className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Preview</p>
        <BrandScope
          colours={{ primary, secondary, accent }}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
        >
          <div className="flex items-center gap-3 bg-[var(--brand-primary)] px-4 py-3 text-[var(--brand-on-primary)]">
            <OrganisationLogo name={previewName} logoUrl={home.organisation.logoUrl} size={32} />
            <span className="truncate font-semibold">{previewName}</span>
          </div>
          <div className="h-1 bg-[var(--brand-accent)]" />
          <div className="p-4">
            <div className="rounded-xl bg-[var(--brand-secondary)] p-4 text-[var(--brand-on-secondary)]">
              <p className="font-semibold">Welcome to {previewName}</p>
              <p className="mt-1 line-clamp-4 text-sm whitespace-pre-line">
                {welcomeMessage || 'Your welcome message will appear here.'}
              </p>
            </div>
            <span className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-on-primary)]">
              Read the constitution
            </span>
          </div>
        </BrandScope>
      </aside>
    </div>
  );
}
