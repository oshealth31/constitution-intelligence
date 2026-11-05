# Tamper-evident audit log (daily seal)

The database already refuses changes to the audit log. This adds a way to **detect** a change
made by someone who got full database access anyway (Task D12, decision: daily).

## How it works

1. Every audit entry has a running number (`seq`, set by the database; the application cannot
   choose it). A missing entry leaves a gap.
2. **Seal (daily, 02:30):** new entries are written into numbered batch files
   (`audit-seal-000001.json`, ...). Per entry a batch holds its number, id, organisation, time
   and two SHA-256 fingerprints: one of **what happened** (time, organisation, who, action,
   outcome, target type, request) and one of the **personal details** (IP address, device,
   target, details). Each batch also holds the previous batch's fingerprint (a chain) and an
   Ed25519 **signature**. Batches contain **no personal data**, so they never need deleting
   after a personal data deletion. Entries younger than 10 minutes wait for the next run.
3. **Copy off-site:** `ops/audit-seal-offsite.sh` adds new batches to the off-site location with
   the add-only account (never overwriting), then downloads the off-site copy back.
4. **Check:** the database is compared with the **off-site copy** (not the local files). The
   chain, fingerprints and signatures are verified, then every sealed entry:
   - **Allowed:** gone because its organisation's data was deleted (D3); a platform-level entry
     removed during an organisation deletion (an `organisation.deleted` event exists after it);
     only the personal details changed and a person was deleted afterwards (D11, decision A1).
   - **Problem:** what happened, when or by whom changed; an entry missing for any other reason;
     an entry added into an already sealed range; a broken chain, a changed batch, a bad
     signature or a different key; no batch newer than 36 hours (sealing stopped).

The check exits with status 2 on any problem, so systemd marks the run failed, and Control
Centre → **System health** shows "Audit log seal" with the last seal, the last check and the
first problems. A failed check makes the overall status "degraded".

## What it does not do

- It **detects**, it does not prevent.
- Entries are protected only once sealed: up to about a day (decision: daily).
- Someone who controls the whole server has the signing key, and could rewrite batches that
  are not yet off-site. The off-site copy is safe from them only if the off-site storage
  refuses overwrites. **When choosing the off-site provider (S6), choose one with write-once
  storage ("object lock" / WORM)** and keep the audit seals in that mode.
- The check runs on the same server. To check independently, download the off-site batches to
  another computer and run the check with only the public key (below).
- No email alert yet (task S5): watch `systemctl is-failed constitution-audit-seal` and System
  health.

## Set up (once)

```bash
cd /srv/constitution/infra/production
# 1. The signing key (keep a copy with the other sealed secrets; never share it)
docker compose run --rm -T --no-deps api node dist/cli/audit-seal.js --generate-key > secrets/audit_seal_key
chmod 0600 secrets/audit_seal_key
# 2. Where batches go off-site, next to (NOT inside) the backups folder, in ./.env:
echo 'OFFSITE_AUDIT_REMOTE=offsite:<bucket>/audit-seals' >> .env
# 3. Restart the API so it sees the key, then write down the public key fingerprint
docker compose up -d api
docker compose run --rm -T api node dist/cli/audit-seal.js --public-key > audit-seal-public.pem
cat audit-seal-public.pem   # keep this file (and the fingerprint) somewhere off the server
# 4. The daily timer
sudo cp systemd/constitution-audit-seal.service systemd/constitution-audit-seal.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now constitution-audit-seal.timer
sudo systemctl start constitution-audit-seal   # first run now; then check:
journalctl -u constitution-audit-seal -n 30
```

The API container must have started once before the first `--seal` (it prepares the batch
folder with the right owner).

## If the check reports a problem

Treat it as a security incident ([incident response](incident-response.md)):

1. Do not "fix" the database or the batches. Keep the evidence: copy the check output
   (`journalctl -u constitution-audit-seal`), the local and off-site batches, and the newest
   backups.
2. Read the problems: which entry numbers, and whether the entry was changed, removed or added,
   or a batch itself was changed.
3. Compare the entry with the same entry in an older backup (restored to a separate database,
   see [backup-and-restore.md](backup-and-restore.md)) to see what it said before.
4. Check who had database access, and rotate the database passwords
   ([secrets.md](secrets.md)).

A known cause of a false alarm: restoring the database from a backup (the restored database is
older than the newest seal). After a restore, the newer sealed entries are "missing": record the
restore in the change log, then start a new chain by moving the old batches aside (keep them).

## Commands

```bash
docker compose run --rm -T api node dist/cli/audit-seal.js --seal
docker compose --profile ops run --rm -T ops /ops/audit-seal-offsite.sh
docker compose run --rm -T api node dist/cli/audit-seal.js --check --dir /var/lib/constitution/audit-check
# Independent check with the public key only (batches downloaded to ./copy):
docker compose run --rm -T -v "$PWD/copy:/copy:ro" -v "$PWD/audit-seal-public.pem:/pub.pem:ro" api \
  node dist/cli/audit-seal.js --check --dir /copy --key-file /pub.pem
```

## Tested

`apps/api/test/audit-seal.e2e.spec.ts`: numbering cannot be forged; batches contain no personal
data; a clean check; recent entries wait; a changed entry (what happened, or the details), an
edited batch, the wrong key, sealing that stopped and a deleted entry are all reported; an
organisation deletion and a D11 anonymisation are allowed. The deployment check seals, copies
off-site with the add-only account (which cannot delete a batch), checks, accepts an
organisation deletion, and detects an entry changed and an entry deleted by a database
superuser. **Not yet run on the real server.**
