'use client';

// Control Centre: an organisation's uploaded files, with the quarantine tool. Every rule
// (Super Admin only, a reason for each step, "remove" only from quarantine, no release after
// removal) is enforced by the API; this card shows the files and collects the reason.
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Loading, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface StaffFile {
  id: string;
  originalFilename: string;
  contentType: string;
  purpose: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string | null;
  usedBy: string | null;
  downloads: number;
  lastDownloadAt: string | null;
  status: 'available' | 'quarantined' | 'removed';
  quarantinedAt: string | null;
  quarantineReason: string | null;
  quarantinedBy: string | null;
  contentRemovedAt: string | null;
}

interface Download {
  at: string;
  name: string | null;
  email: string | null;
  via: string | null;
}

type Action = 'quarantine' | 'release' | 'remove';

const ACTION_TEXT: Record<Action, { button: string; done: string; hint: string }> = {
  quarantine: {
    button: 'Quarantine',
    done: 'File quarantined. Nobody can download it now.',
    hint: 'Stops every download straight away. It can be released later.',
  },
  release: {
    button: 'Release',
    done: 'File released. It can be downloaded again.',
    hint: 'Use when the file turned out to be safe.',
  },
  remove: {
    button: 'Remove permanently',
    done: 'The stored file has been deleted. This cannot be undone.',
    hint: 'Deletes the stored file for good. The record and the text already read from it stay.',
  },
};

function StatusLabel({ file }: { file: StaffFile }) {
  if (file.status === 'removed') return <Badge tone="critical">Removed</Badge>;
  if (file.status === 'quarantined') return <Badge tone="warning">Quarantined</Badge>;
  return <Badge tone="good">Available</Badge>;
}

export function FilesCard({ organisationId }: { organisationId: string }) {
  const base = `/platform/organisations/${organisationId}/files`;
  const state = useApi<StaffFile[]>(base);
  const [open, setOpen] = useState<{ fileId: string; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);
  const [downloads, setDownloads] = useState<{ fileId: string; rows: Download[] } | null>(null);

  if (state.error) return <Alert>{describeError(state.error)}</Alert>;
  if (!state.data) {
    return (
      <Card title="Uploaded files">
        <Loading />
      </Card>
    );
  }
  const list = state.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open) return;
    const { fileId, action } = open;
    setBusy(true);
    setNotice(null);
    void apiFetch<StaffFile[]>(`${base}/${fileId}/${action}`, {
      method: 'POST',
      body: { reason },
    })
      .then((rows) => {
        state.setData(rows);
        setOpen(null);
        setReason('');
        setNotice({ tone: 'good', text: ACTION_TEXT[action].done });
      })
      .catch((caught: unknown) => setNotice({ tone: 'critical', text: describeError(caught) }))
      .finally(() => setBusy(false));
  }

  function showDownloads(fileId: string) {
    if (downloads?.fileId === fileId) {
      setDownloads(null);
      return;
    }
    void apiFetch<Download[]>(`${base}/${fileId}/downloads`)
      .then((rows) => setDownloads({ fileId, rows }))
      .catch((caught: unknown) => setNotice({ tone: 'critical', text: describeError(caught) }));
  }

  return (
    <Card
      title="Uploaded files"
      description="If a file may be unsafe (for example a suspected virus), quarantine it: every download stops at once. Quarantine cannot clean copies people already downloaded — the download list shows who has one."
    >
      <div className="space-y-4">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {list.length === 0 && <EmptyState>No files uploaded yet.</EmptyState>}
        <ul className="divide-y divide-slate-200">
          {list.map((file) => {
            const actions: Action[] =
              file.status === 'available'
                ? ['quarantine']
                : file.status === 'quarantined'
                  ? ['release', 'remove']
                  : [];
            return (
              <li key={file.id} className="py-3" data-testid="staff-file">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-all text-navy-900">
                    {file.originalFilename}
                  </span>
                  <StatusLabel file={file} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {formatBytes(file.sizeBytes)} · uploaded {formatDateTime(file.uploadedAt)}
                  {file.uploadedBy ? ` by ${file.uploadedBy}` : ''}
                  {file.usedBy ? ` · ${file.usedBy}` : ''}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Downloaded {formatNumber(file.downloads)}{' '}
                  {file.downloads === 1 ? 'time' : 'times'}
                  {file.lastDownloadAt ? ` (last ${formatDateTime(file.lastDownloadAt)})` : ''}
                  {file.downloads > 0 && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="text-teal-600 hover:underline"
                        onClick={() => showDownloads(file.id)}
                      >
                        {downloads?.fileId === file.id ? 'Hide who' : 'Show who'}
                      </button>
                    </>
                  )}
                </p>
                {file.quarantinedAt && (
                  <p className="mt-1 text-xs text-amber-800">
                    Quarantined {formatDateTime(file.quarantinedAt)}
                    {file.quarantinedBy ? ` by ${file.quarantinedBy}` : ''}: {file.quarantineReason}
                    {file.contentRemovedAt
                      ? ` · stored file removed ${formatDateTime(file.contentRemovedAt)}`
                      : ''}
                  </p>
                )}
                {downloads?.fileId === file.id && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-ivory-50 p-2 text-xs">
                    {downloads.rows.map((row, index) => (
                      <li key={index}>
                        {formatDateTime(row.at)} — {row.name ?? 'Unknown'}
                        {row.email ? ` (${row.email})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {actions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action}
                        variant={action === 'release' ? 'secondary' : 'danger'}
                        onClick={() => {
                          setOpen({ fileId: file.id, action });
                          setReason('');
                          setNotice(null);
                        }}
                      >
                        {ACTION_TEXT[action].button}
                      </Button>
                    ))}
                  </div>
                )}
                {open?.fileId === file.id && (
                  <form onSubmit={submit} className="mt-3 space-y-2">
                    <TextField
                      label="Reason (recorded in the audit log)"
                      hint={ACTION_TEXT[open.action].hint}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      minLength={10}
                      maxLength={500}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant={open.action === 'release' ? 'primary' : 'danger'}
                        busy={busy}
                      >
                        Confirm: {ACTION_TEXT[open.action].button.toLowerCase()}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setOpen(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
