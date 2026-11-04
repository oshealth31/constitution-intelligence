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

Schedule: **daily** from cron (for example 01:30), plus by hand **before every release** and
before any risky change. Local backups older than `BACKUP_KEEP_DAYS` (35) are removed by the
script. The job exits non-zero on any failure: alert on it
([logging-and-monitoring.md](logging-and-monitoring.md)).

### File storage backups

Uploaded files live in the Docker volume `constitution-intelligence_storage`
(`/var/lib/constitution/storage` in the API container), under `tenants/<organisation id>/`.
They are included in every backup above, in the same run as the database, so a backup's files
always match its rows. Files are never overwritten by the application (new versions are new
files), which makes the archive simple to check. If storage moves to an object-storage service
later, its versioning and a separate copy replace the `tar` step.

### Off-site copy (required, not yet set up)

A backup on the same server does not survive losing the server. After each backup, copy the
new folder to a second location **in Botswana** (or wherever the data-protection review
allows), for example with `rsync` over SSH or `rclone` to an in-country object store, using
an account that can add files but not delete them. Keep 35 daily and 12 monthly copies. This
needs the hosting decision (production-readiness.md).

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
admin -d constitution -c 'CREATE DATABASE constitution_restored OWNER constitution_app'
admin -d constitution_restored -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' \
  -c 'CREATE EXTENSION IF NOT EXISTS vector' -c 'ALTER SCHEMA public OWNER TO constitution_app'
printf 'postgresql://constitution_app:%s@postgres:5432/constitution_restored' \
  "$(cat secrets/app_db_password)" > secrets/restore_url && chmod 600 secrets/restore_url
docker volume create constitution-intelligence_storage_restored
docker run --rm --network constitution-intelligence_data \
  -v "$PWD/backups:/backups:ro" -v "$PWD/secrets:/s:ro" \
  -v constitution-intelligence_storage_restored:/restored \
  -e TARGET_DATABASE_URL_FILE=/s/restore_url -e TARGET_STORAGE_DIR=/restored \
  -e BACKUP_PASSPHRASE_FILE=/s/backup_passphrase \
  -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/s/database_ca.crt \
  "$OPS_IMAGE" /ops/restore.sh /backups/<backup folder>
```

Then check it (sign in, open a constitution, search), switch `database_url` to the restored
database and the `storage` volume to the restored one, and restart `api`. Keep the old
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
