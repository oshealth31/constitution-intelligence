#!/usr/bin/env bash
# Constitution Intelligence: export ONE organisation's data (offboarding, or a data request).
#
# Usage: ops/export-organisation.sh <organisation id>
#
# Settings (environment):
#   DATABASE_URL_FILE (or DATABASE_URL)  connection string (application account)
#   STORAGE_DIR                          uploaded files folder        (default /storage)
#   EXPORT_DIR                           where the export is written  (default /exports)
#   BACKUP_PASSPHRASE_FILE               passphrase used to encrypt the export (required)
#
# Produces EXPORT_DIR/<slug>-<UTC timestamp>.tar.gz.gpg containing:
#   data/<table>.json   that organisation's rows only (one JSON array per table)
#   files/...           the original uploaded documents and logo
#   README.txt          what is included and what is deliberately left out
#   SHA256SUMS
# Left out on purpose: passwords and their hashes, sign-in sessions, one-time link tokens,
# rate-limit counters, search indexes, and members' private AI questions (each person's own).
set -euo pipefail
umask 077

die() { echo "export: $*" >&2; exit 1; }
organisation_id="${1:-}"
[[ "$organisation_id" =~ ^[0-9a-f-]{36}$ ]] || die "usage: export-organisation.sh <organisation id (UUID)>"
if [[ -n "${DATABASE_URL_FILE:-}" ]]; then DATABASE_URL="$(cat "$DATABASE_URL_FILE")"; fi
[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL or DATABASE_URL_FILE must be set"
[[ -n "${BACKUP_PASSPHRASE_FILE:-}" && -s "${BACKUP_PASSPHRASE_FILE}" ]] ||
  die "BACKUP_PASSPHRASE_FILE must point to a non-empty file"
STORAGE_DIR="${STORAGE_DIR:-/storage}"
EXPORT_DIR="${EXPORT_DIR:-/exports}"

# Runs one SQL statement; :'org' inside it is the organisation id, safely quoted by psql.
q() { printf '%s\n' "$1" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -v org="$organisation_id"; }
slug="$(q "SELECT slug FROM organisations WHERE id = :'org'")"
[[ -n "$slug" ]] || die "no organisation with that id"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
root="$work/$slug-$stamp"
mkdir -p "$root/data" "$root/files"

# Tables exported, with columns that must never leave the system.
declare -A EXCLUDE=(
  [organisations]="" [organisation_branding]="" [constitutions]="" [constitution_versions]=""
  [extracted_texts]="" [sections]="" [content_approvals]="" [approved_answers]=""
  [approved_answer_sections]="" [simplified_sections]="" [memberships]=""
  [invitations]="token_hash" [subscriptions]="" [invoices]="" [payments]=""
  [subscription_events]="" [audit_events]="" [files]="" [usage_records]=""
)

for table in "${!EXCLUDE[@]}"; do
  key="organisation_id"; [[ "$table" == "organisations" ]] && key="id"
  has_key="$(q "SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = '$table' AND column_name = '$key'")"
  [[ "$has_key" == "1" ]] || { echo "export: skipping $table (no $key column)"; continue; }
  drop=""
  for column in ${EXCLUDE[$table]}; do drop="$drop - '$column'"; done
  q "SELECT coalesce(json_agg(to_jsonb(t) $drop ORDER BY to_jsonb(t)->>'id'), '[]'::json)
        FROM public.$table t WHERE t.$key = :'org'" > "$root/data/$table.json"
done

# People: only the members of this organisation, and only their names and email addresses.
q "SELECT coalesce(json_agg(json_build_object('id', u.id, 'email', u.email,
        'display_name', u.display_name, 'role', m.role, 'status', m.status) ORDER BY u.email), '[]')
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organisation_id = :'org'" \
  > "$root/data/people.json"

# Original files, from the organisation's own storage folder only.
if [[ -d "$STORAGE_DIR/tenants/$organisation_id" ]]; then
  cp -R "$STORAGE_DIR/tenants/$organisation_id/." "$root/files/"
fi

cat > "$root/README.txt" <<TXT
Constitution Intelligence: data export for organisation "$slug" ($organisation_id)
Created (UTC): $stamp

data/*.json  - this organisation's records, one JSON array per table (people.json: members'
               names, email addresses and roles).
files/       - original uploaded documents and the logo, as stored.

Not included, on purpose: passwords and password hashes, sign-in sessions, one-time link
tokens, rate-limit counters, search indexes (rebuilt from the text), and members' private AI
questions and answers (each person's own data; available to that person on request).
TXT
(cd "$root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$EXPORT_DIR"
tar -C "$work" -czf "$work/export.tar.gz" "$slug-$stamp"
out="$EXPORT_DIR/$slug-$stamp.tar.gz.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 --output "$out" "$work/export.tar.gz"
echo "export: done -> $out"
