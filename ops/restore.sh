#!/usr/bin/env bash
# Constitution Intelligence: restore a backup made by ops/backup.sh into an EMPTY database
# and an EMPTY storage folder. It never overwrites existing data: restore into a new database,
# check it, then point the application at it (docs/operations/backup-and-restore.md).
#
# Usage: ops/restore.sh <backup folder>
#
# Settings (environment):
#   TARGET_DATABASE_URL_FILE  file holding the target connection string (or TARGET_DATABASE_URL)
#   TARGET_STORAGE_DIR        empty folder to restore files into
#   BACKUP_PASSPHRASE_FILE    file holding the passphrase used for the backup
set -euo pipefail
umask 077

die() { echo "restore: $*" >&2; exit 1; }

source_dir="${1:-}"
[[ -n "$source_dir" && -d "$source_dir" ]] || die "usage: restore.sh <backup folder>"
if [[ -n "${TARGET_DATABASE_URL_FILE:-}" ]]; then TARGET_DATABASE_URL="$(cat "$TARGET_DATABASE_URL_FILE")"; fi
[[ -n "${TARGET_DATABASE_URL:-}" ]] || die "TARGET_DATABASE_URL or TARGET_DATABASE_URL_FILE must be set"
[[ -n "${TARGET_STORAGE_DIR:-}" ]] || die "TARGET_STORAGE_DIR must be set"
[[ -n "${BACKUP_PASSPHRASE_FILE:-}" && -s "${BACKUP_PASSPHRASE_FILE}" ]] ||
  die "BACKUP_PASSPHRASE_FILE must point to a non-empty file"

echo "restore: checking the backup's checksums"
(cd "$source_dir" && sha256sum --check --quiet SHA256SUMS) || die "checksums do not match: backup damaged or altered"

tables="$(psql "$TARGET_DATABASE_URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[[ "$tables" == "0" ]] || die "the target database is not empty ($tables tables); restore into a new database"
mkdir -p "$TARGET_STORAGE_DIR"
[[ -z "$(ls -A "$TARGET_STORAGE_DIR")" ]] || die "the target storage folder is not empty"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
decrypt() { # decrypt <encrypted file> <plain file>
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
    --decrypt --output "$2" "$1"
}
decrypt "$source_dir/database.dump.gpg" "$work/database.dump"
decrypt "$source_dir/storage.tar.gz.gpg" "$work/storage.tar.gz"

echo "restore: preparing roles"
# The restricted tenant role is a server-wide role, so it is not inside the dump.
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT app_tenant TO %I', current_user);
END $$;
SQL

echo "restore: restoring the database"
# Extensions are created by the administrator when the database is made; comments on them
# can only be set by a superuser, so those entries are left out.
pg_restore --list "$work/database.dump" | grep -v ' COMMENT - EXTENSION ' > "$work/restore.list"
pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --exit-on-error --single-transaction \
  --use-list="$work/restore.list" "$work/database.dump"

echo "restore: restoring uploaded files"
tar -C "$TARGET_STORAGE_DIR" -xzf "$work/storage.tar.gz"

echo "restore: comparing with the backup's manifest"
expected="$(grep '^rows\.' "$source_dir/manifest.txt" | sort)"
actual="$(psql "$TARGET_DATABASE_URL" -At -F '=' -c "
  SELECT 'rows.' || c.relname, (xpath('/row/n/text()',
    query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname" | sort)"
[[ "$expected" == "$actual" ]] || { diff <(echo "$expected") <(echo "$actual") >&2 || true; die "row counts differ from the backup"; }
expected_files="$(grep '^files=' "$source_dir/manifest.txt" | cut -d= -f2)"
actual_files="$(find "$TARGET_STORAGE_DIR" -type f | wc -l)"
[[ "$expected_files" == "$actual_files" ]] || die "file count differs: expected $expected_files, got $actual_files"

echo "restore: done. $(echo "$actual" | wc -l) tables and $actual_files files match the backup's manifest."
