'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  ProgressBar,
  SelectField,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { apiFetch, describeError, type OrganisationListItem } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useApi } from '@/lib/use-api';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function CreateOrganisationForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>('/platform/organisations', {
        method: 'POST',
        body: { name, slug },
      });
      router.push(`/admin/organisations/${created.id}`);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Card
      title="New organisation"
      description="Creates the organisation with default branding and a 30-day trial."
    >
      <form method="post" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" aria-label="New organisation">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <TextField
          label="Organisation name"
          required
          minLength={2}
          maxLength={200}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(slugify(event.target.value));
          }}
        />
        <TextField
          label="Web address (slug)"
          required
          pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
          hint="Lower-case letters, numbers and hyphens. Used in the portal address."
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
        />
        <div className="flex gap-3 sm:col-span-2">
          <Button type="submit" busy={busy}>
            Create organisation
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function OrganisationsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (query) params.set('search', query);
    const text = params.toString();
    return `/platform/organisations${text ? `?${text}` : ''}`;
  }, [status, query]);
  const organisations = useApi<OrganisationListItem[]>(path);

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Every customer organisation, its subscription, onboarding progress and constitution status."
        actions={!creating && <Button onClick={() => setCreating(true)}>New organisation</Button>}
      />
      {creating && (
        <div className="mb-6">
          <CreateOrganisationForm onCancel={() => setCreating(false)} />
        </div>
      )}

      <Card>
        <form method="post"
          className="mb-5 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
          }}
          role="search"
        >
          <TextField
            label="Search"
            placeholder="Name or slug"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {organisations.error ? <Alert>{describeError(organisations.error)}</Alert> : null}
        {organisations.loading && !organisations.data ? <Loading /> : null}
        {organisations.data && organisations.data.length === 0 && (
          <EmptyState>No organisations match.</EmptyState>
        )}
        {organisations.data && organisations.data.length > 0 && (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-ivory-100 text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium sm:px-6">
                    Organisation
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Subscription
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Onboarding
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Constitution
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Members
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ivory-100">
                {organisations.data.map((organisation) => (
                  <tr key={organisation.id} className="align-top hover:bg-ivory-50">
                    <td className="px-5 py-3 sm:px-6">
                      <Link
                        href={`/admin/organisations/${organisation.id}`}
                        className="font-medium text-navy-900 hover:underline"
                      >
                        {organisation.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {organisation.slug} · since {formatDate(organisation.createdAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        status={organisation.deletedAt ? 'deleted' : organisation.status}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {organisation.subscription ? (
                        <div className="space-y-1">
                          <StatusBadge status={organisation.subscription.status} />
                          <p className="text-xs text-muted capitalize">
                            {organisation.subscription.planCode}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">None</span>
                      )}
                    </td>
                    <td className="w-40 px-3 py-3">
                      <ProgressBar
                        value={organisation.onboarding.completed}
                        total={organisation.onboarding.total}
                        label={`Onboarding progress for ${organisation.name}`}
                      />
                    </td>
                    <td className="px-3 py-3 text-xs text-navy-900">
                      {organisation.publishedVersions > 0 ? (
                        <StatusBadge status="published" />
                      ) : organisation.versionsInProgress > 0 ? (
                        <StatusBadge status="in_review" />
                      ) : (
                        <span className="text-muted">Not uploaded</span>
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-navy-900">
                      {formatNumber(organisation.activeMembers)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
