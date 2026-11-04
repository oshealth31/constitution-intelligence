#!/usr/bin/env bash
# Constitution Intelligence: encrypted backup of the database and uploaded files.
#
# Usage (inside the "backup" container, see docs/operations/backup-and-restore.md):
#   ops/backup.sh
#
# Settings (environment):
#   DATABASE_URL_FILE        file holding the connection string (or DATABASE_URL)
#   STORAGE_DIR              folder with uploaded files            (default /storage)
#   BACKUP_DIR               where backups are written            (default /backups)
#   BACKUP_PASSPHRASE_FILE   file holding the encryption passphrase (required)
#   BACKUP_KEEP_DAYS         delete local backups older than this (default 35)
#
# Writes BACKUP_DIR/<UTC timestamp>/ with:
#   database.dump.gpg   pg_dump custom format, encrypted (AES-256)
#   storage.tar.gz.gpg  every uploaded file, encrypted
#   manifest.txt        what was backed up: time, database version, row counts per table
#   SHA256SUMS          checksums of the three files above
# Nothing unencrypted is left behind. Exit status is non-zero on any failure.
set -euo pipefail
umask 077

die() { echo "backup: $*" >&2; exit 1; }

if [[ -n "${DATABASE_URL_FILE:-}" ]]; then DATABASE_URL="$(cat "$DATABASE_URL_FILE")"; fi
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL or DATABASE_URL_FILE must be set"
[[ -n "${BACKUP_PASSPHRASE_FILE:-}" && -s "${BACKUP_PASSPHRASE_FILE}" ]] ||
  die "BACKUP_PASSPHRASE_FILE must point to a non-empty file"
STORAGE_DIR="${STORAGE_DIR:-/storage}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
[[ -d "$STORAGE_DIR" ]] || die "storage folder $STORAGE_DIR does not exist"
command -v pg_dump >/dev/null && command -v gpg >/dev/null || die "pg_dump and gpg are required"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/$stamp"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$target"

encrypt() { # encrypt <plain file> <encrypted file>
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$2" "$1"
}

echo "backup: dumping the database"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$work/database.dump"

echo "backup: archiving uploaded files"
tar -C "$STORAGE_DIR" -czf "$work/storage.tar.gz" .

echo "backup: recording what was backed up"
{
  echo "created_utc=$stamp"
  echo "database_server=$(psql "$DATABASE_URL" -Atc 'SHOW server_version')"
  echo "migrations_applied=$(psql "$DATABASE_URL" -Atc 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
  echo "files=$(find "$STORAGE_DIR" -type f | wc -l)"
  psql "$DATABASE_URL" -At -F '=' -c "
    SELECT 'rows.' || c.relname, (xpath('/row/n/text()',
      query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname"
} > "$target/manifest.txt"

echo "backup: encrypting"
encrypt "$work/database.dump" "$target/database.dump.gpg"
encrypt "$work/storage.tar.gz" "$target/storage.tar.gz.gpg"
(cd "$target" && sha256sum database.dump.gpg storage.tar.gz.gpg manifest.txt > SHA256SUMS)

echo "backup: removing local backups older than $BACKUP_KEEP_DAYS days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -mtime +"$BACKUP_KEEP_DAYS" \
  -exec rm -rf {} +

echo "backup: done -> $target"
echo "$target"
