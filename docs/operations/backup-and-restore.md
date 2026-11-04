# Backup and restore

## What is backed up

| Part                                                                             | How                                                                      | Where                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| Database (every table, row-level security policies, triggers, migration history) | `pg_dump` custom format, run as the application account (sees every row) | `database.dump.gpg`  |
| Uploaded files (original constitutions, logos)                                   | `tar` of the `storage` volume                                            | `storage.tar.gz.gpg` |
| What was backed up                                                               | Time, database version, number of migrations, files, rows per table      | `manifest.txt`       |
| Integrity                                                                        | SHA-256 of the three files                                               | `SHA256SUMS`         |

Both data files are encrypted (AES-256, gpg) with `backup_passphrase`; nothing unencrypted is
written. Not in the backup, on purpose: the secrets (kept separately, see
[secrets.md](secrets.md)), Caddy's certificates (re-issued automatically) and container logs.

## Taking backups

```bash
cd /srv/constitution/infra/production
docker compose --profile ops run --rm ops     # -> backups/<UTC time>/
```

Schedule: **nightly** with the off-site copy (see "Schedule" below), plus by hand **before every
release** and before any risky change. Local backups older than `BACKUP_KEEP_DAYS` (35) are
removed by the script. The job exits non-zero on any failure: alert on it
([logging-and-monitoring.md](logging-and-monitoring.md)).

### File storage backups

Uploaded files live in the Docker volume `constitution-intelligence_storage`
(`/var/lib/constitution/storage` in the API container), under `tenants/<organisation id>/`.
They are included in every backup above, in the same run as the database, so a backup's files
always match its rows. Files are never overwritten by the application (new versions are new
files), which makes the archive simple to check. If storage moves to an object-storage service
later, its versioning and a separate copy replace the `tar` step.

### Off-site copy (Task D7: built and tested; the location is still to be chosen, setup S6)

A backup on the same server does not survive losing the server. Every night the backup is
copied to a second location by `ops/offsite-copy.sh`, using [rclone](https://rclone.org), which
works with almost every storage service (S3-compatible object storage such as Oracle Object
Storage, Backblaze B2, Cloudflare R2 or an in-country provider; SFTP to another server).

- **Already encrypted before it leaves.** The provider only ever stores the gpg-encrypted files
  (AES-256). Without `backup_passphrase` they are unreadable, so the provider never sees data.
- **Checked twice.** Before sending, the local checksums are verified (a damaged backup is never
  sent). After sending, the off-site `SHA256SUMS` is downloaded and compared, and every file's
  size and checksum is compared (`rclone check`). Any difference fails the job.
- **Add-only account.** Files are copied with `--immutable` (never overwritten). The account in
  `secrets/rclone.conf` should be allowed to **add and read**, not delete: then someone who takes
  over the server cannot wipe the off-site copies. Also turn on **versioning** (or object lock)
  in the bucket, so an overwritten file keeps its earlier version.
- **Keeping 35 daily and 12 monthly copies.** `ops/offsite-prune.sh` keeps the newest 35 and the
  newest of each of the last 12 months. It only prints its plan unless run with `--yes`, and must
  be run with a **separate** rclone configuration whose account may delete (a person, monthly).
  Alternatively set an expiry rule in the provider.
- **Getting a backup back** (lost server): `ops/offsite-fetch.sh` lists the off-site backups;
  `ops/offsite-fetch.sh <folder>` downloads one into an empty folder and checks its checksums,
  then restore it as below.

**Choosing the location (S6)**: in Botswana if possible, or wherever the data-protection review
allows (the backups contain personal data, even though encrypted); a different provider or at
least a different region from the server; and a provider whose accounts can be limited to
add-and-read. Record the choice in production-readiness.md.

**Setting it up**

1. Create the bucket (versioning on) and an **add-and-read** key; and separately an admin key for
   pruning, kept off the server.
2. Write `secrets/rclone.conf` (`chmod 600`), for example for an S3-compatible service:
   ```ini
   [offsite]
   type = s3
   provider = Other
   access_key_id = <add-and-read key id>
   secret_access_key = <secret>
   endpoint = https://<provider endpoint>
   ```
3. Put `OFFSITE_REMOTE=offsite:<bucket>/prod` in `infra/production/.env`.
4. Test it: `docker compose --profile ops run --rm -T ops /ops/backup-and-copy.sh`.
5. Schedule it (below).

### Schedule (Task D7)

The nightly job `ops/backup-and-copy.sh` takes the backup and then the off-site copy; it exits
non-zero if either fails (and with status 2 if no off-site location is set). Install the systemd
timer on the server (runs at 01:30 server time; set the server to Africa/Gaborone first):

```bash
sudo timedatectl set-timezone Africa/Gaborone
sudo cp /srv/constitution/infra/production/systemd/constitution-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now constitution-backup.timer
systemctl list-timers constitution-backup.timer      # next run
sudo systemctl start constitution-backup.service     # run once now
journalctl -u constitution-backup.service -n 50      # what happened
```

`infra/production/systemd/check-backups.sh` reports how old the newest backup and the last good
off-site copy are, and fails if either is older than 26 hours: the monitoring (task S5) should
run it and alert. Also take a backup by hand **before every release** and before any risky change.

**Tested** (Deployment check, on every change and weekly): the backup is copied to a throwaway
S3-compatible store (MinIO) with an add-only account; a second run copies nothing new; the
account is refused when it tries to delete; an overwrite keeps the earlier version; the copy is
downloaded back into an empty folder, is byte-for-byte identical, and **the restore test then
restores that downloaded copy**; pruning keeps the right backups. **Not tested yet: a real
provider, and the timer on a real server.**

## Restoring

`ops/restore.sh` restores into an **empty** database and an **empty** storage folder only. It
refuses anything else, so a mistake cannot overwrite live data. It:

1. checks the SHA-256 checksums (a damaged or altered backup is refused);
2. decrypts with the passphrase (a wrong passphrase is refused);
3. prepares the restricted `app_tenant` role (server-wide, so not inside the dump);
4. restores the database in a single transaction (all or nothing);
5. restores the files;
6. compares the row count of every table and the file count with `manifest.txt`, and fails
   if anything differs.

### Restoring for real (data loss, or rollback B)

```bash
cd /srv/constitution/infra/production
admin() { docker compose exec -T postgres psql -U constitution_owner -v ON_ERROR_STOP=1 "$@"; }
admin -d constitution -c 'CREATE DATABASE constitution_restored OWNER constitution_migrator'
admin -d constitution_restored -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' \
  -c 'CREATE EXTENSION IF NOT EXISTS vector' -c 'ALTER SCHEMA public OWNER TO constitution_migrator'
# The restore runs as the MIGRATION account, which then owns the restored tables.
printf 'postgresql://constitution_migrator:%s@postgres:5432/constitution_restored' \
  "$(cat secrets/migrator_db_password)" > secrets/restore_url && chmod 600 secrets/restore_url
docker volume create constitution-intelligence_storage_restored
docker run --rm --network constitution-intelligence_data \
  -v "$PWD/backups:/backups:ro" -v "$PWD/secrets:/s:ro" \
  -v constitution-intelligence_storage_restored:/restored \
  -e TARGET_DATABASE_URL_FILE=/s/restore_url -e TARGET_STORAGE_DIR=/restored \
  -e BACKUP_PASSPHRASE_FILE=/s/backup_passphrase \
  -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/s/database_ca.crt \
  "$OPS_IMAGE" /ops/restore.sh /backups/<backup folder>
```

Then check it (sign in, open a constitution, search), switch `database_url` (application
account, `constitution_app`) and `database_migrator_url` to the restored database and the `storage` volume to the restored one, and restart `api`. Keep the old
database untouched until the restored one has run for a while. If the server itself is lost:
new server ([deployment.md](deployment.md)), the secrets from their safe copy, the backup from
the off-site copy, then the same steps.

## Restore test record

**Restore tests have been performed only in a throwaway test environment, on fictional data.**
No restore has been performed on production infrastructure, because none exists yet. The
off-site copy has not been tested.

| Date       | Where                                                                                                                                                                                      | What was restored                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4 Nov 2026 | GitHub Actions runner, production images and layout, TLS database, generated secrets ([run 41766576968](https://github.com/oshealth31/constitution-intelligence/actions/runs/41766576968)) | Fictional development data: 2 organisations, 8 users, 2 constitutions with 4 versions and 36 sections, 4 stored files, 9 migrations (29 tables) | **Passed**: checksums verified; 29 tables matched row for row; the 4 files were byte-identical (SHA-256); the audit log was still append-only; row-level security still showed one organisation to the tenant role; a member signed in **on the restored copy** through the API and saw 1 constitution and 6 search results for "meeting" |

Also tested locally (4 Nov 2026), on a small stand-in database: restore refuses a database
that is not empty, a backup whose checksum does not match, and a wrong passphrase.

The same test runs automatically on every pull request that touches the application or
infrastructure, and every Monday (Deployment check workflow). Its results are evidence for
the code and procedure, **not** for a real server's backups. After go-live, the quarterly
restore test on the real backups (on a separate machine) is the evidence that recovery works.
Record each one in this table.

| Target                                               | Value                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Recovery point objective (how much data may be lost) | 24 hours (daily backup); shorter needs continuous archiving (PostgreSQL WAL), not set up |
| Recovery time objective (how long to restore)        | 4 hours, to be confirmed by the first real restore test                                  |
