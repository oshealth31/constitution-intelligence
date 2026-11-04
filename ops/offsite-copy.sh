#!/usr/bin/env bash
# Constitution Intelligence: copy encrypted backups to a second, off-site location (Task D7).
#
# Usage (inside the "ops" container, see docs/operations/backup-and-restore.md):
#   ops/offsite-copy.sh            # copy every local backup the off-site location does not have yet
#   ops/offsite-copy.sh <folder>   # copy one backup folder (a name like 20261104T013000Z)
#
# Settings (environment):
#   OFFSITE_REMOTE       rclone destination, for example "offsite:constitution-backups/prod"
#   RCLONE_CONFIG        rclone configuration file holding the off-site account (a secret file)
#   BACKUP_DIR           local backups                                    (default /backups)
#
# What it does, for each backup folder:
#   1. checks the local SHA256SUMS first (a damaged backup is never sent);
#   2. copies the folder's files with --immutable: a file that already exists off-site is never
#      overwritten, so the account only needs permission to ADD files (not to change or delete);
#   3. checks the copy: downloads SHA256SUMS from the off-site location and compares every file's
#      size and checksum with the local one.
# Backups are already encrypted (gpg, AES-256) before they leave: the off-site provider never
# sees readable data. Writes BACKUP_DIR/.offsite-last-success (UTC time) after a good run.
# Exit status is non-zero on any failure.
set -euo pipefail
umask 077

die() { echo "offsite: $*" >&2; exit 1; }

[[ -n "${OFFSITE_REMOTE:-}" ]] || die "OFFSITE_REMOTE must be set (for example offsite:bucket/path)"
[[ -n "${RCLONE_CONFIG:-}" && -s "${RCLONE_CONFIG}" ]] || die "RCLONE_CONFIG must point to a non-empty file"
command -v rclone >/dev/null || die "rclone is required"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
export RCLONE_CONFIG

if [[ $# -gt 0 ]]; then
  folders=("$1")
else
  mapfile -t local_folders < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -printf '%f\n' | sort)
  mapfile -t remote_folders < <(rclone lsf --dirs-only "$OFFSITE_REMOTE" 2>/dev/null | sed 's#/$##' | sort || true)
  folders=()
  for folder in "${local_folders[@]}"; do
    if ! printf '%s\n' "${remote_folders[@]}" | grep -qx "$folder"; then folders+=("$folder"); fi
  done
fi
[[ ${#folders[@]} -gt 0 ]] || { echo "offsite: nothing new to copy"; date -u +%Y%m%dT%H%M%SZ > "$BACKUP_DIR/.offsite-last-success"; exit 0; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for folder in "${folders[@]}"; do
  [[ "$folder" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || die "not a backup folder name: $folder"
  source_dir="$BACKUP_DIR/$folder"
  [[ -f "$source_dir/SHA256SUMS" ]] || die "$folder has no SHA256SUMS"
  (cd "$source_dir" && sha256sum --check --quiet SHA256SUMS) || die "$folder is damaged locally; not copied"

  echo "offsite: copying $folder"
  rclone copy --immutable --no-traverse --retries 5 --low-level-retries 10 \
    "$source_dir" "$OFFSITE_REMOTE/$folder"

  echo "offsite: checking $folder"
  rclone copyto "$OFFSITE_REMOTE/$folder/SHA256SUMS" "$work/$folder.SHA256SUMS"
  cmp -s "$work/$folder.SHA256SUMS" "$source_dir/SHA256SUMS" || die "$folder: off-site SHA256SUMS differs"
  rclone check --one-way "$source_dir" "$OFFSITE_REMOTE/$folder" ||
    die "$folder: the off-site copy does not match"
done
date -u +%Y%m%dT%H%M%SZ > "$BACKUP_DIR/.offsite-last-success"
echo "offsite: done, ${#folders[@]} backup(s) copied and checked"
