#!/usr/bin/env bash
# Constitution Intelligence: copy the sealed audit batches off-site, then download the off-site
# copy back for the daily check (Task D12; see docs/operations/audit-seal.md).
#
# Usage (inside the "ops" container):  ops/audit-seal-offsite.sh
#
# Settings (environment):
#   OFFSITE_AUDIT_REMOTE  rclone destination for the batches, for example
#                         "offsite:constitution-audit-seals/prod" (NOT inside the backups folder)
#   RCLONE_CONFIG         rclone configuration (the add-only account, as for backups)
#   AUDIT_SEAL_DIR        sealed batches written by the API      (default /audit-seals)
#   AUDIT_CHECK_DIR       where the off-site copy is downloaded  (default /audit-check)
#
# Batches are copied with --immutable: a batch already off-site is never overwritten, so the
# account only needs permission to ADD files. The download then replaces AUDIT_CHECK_DIR with
# exactly what is off-site, so the check compares the database with the off-site copy (not
# with the local files, which someone with access to this server could change).
set -euo pipefail
umask 022

die() { echo "audit-seal-offsite: $*" >&2; exit 1; }

[[ -n "${OFFSITE_AUDIT_REMOTE:-}" ]] || die "OFFSITE_AUDIT_REMOTE must be set (for example offsite:constitution-audit-seals/prod)"
[[ -n "${RCLONE_CONFIG:-}" && -s "${RCLONE_CONFIG}" ]] || die "RCLONE_CONFIG must point to a non-empty file"
command -v rclone >/dev/null || die "rclone is required"
SEAL_DIR="${AUDIT_SEAL_DIR:-/audit-seals}"
CHECK_DIR="${AUDIT_CHECK_DIR:-/audit-check}"
[[ -d "$SEAL_DIR" ]] || die "no sealed batches folder at $SEAL_DIR"

count="$(find "$SEAL_DIR" -maxdepth 1 -name 'audit-seal-*.json' | wc -l)"
echo "audit-seal-offsite: $count sealed batch(es) here; copying new ones to $OFFSITE_AUDIT_REMOTE"
rclone copy --immutable --include 'audit-seal-*.json' "$SEAL_DIR" "$OFFSITE_AUDIT_REMOTE"

# A fresh download of everything off-site, for the check.
find "$CHECK_DIR" -mindepth 1 -maxdepth 1 -name 'audit-seal-*.json' -delete 2>/dev/null || true
mkdir -p "$CHECK_DIR"
rclone copy --include 'audit-seal-*.json' "$OFFSITE_AUDIT_REMOTE" "$CHECK_DIR"
chmod 0644 "$CHECK_DIR"/audit-seal-*.json 2>/dev/null || true
fetched="$(find "$CHECK_DIR" -maxdepth 1 -name 'audit-seal-*.json' | wc -l)"
echo "audit-seal-offsite: downloaded $fetched batch(es) back from off-site for the check"
[[ "$fetched" -ge "$count" ]] || die "the off-site copy has fewer batches ($fetched) than this server ($count)"
