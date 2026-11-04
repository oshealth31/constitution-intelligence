#!/usr/bin/env bash
# Constitution Intelligence: download one backup back from the off-site location (Task D7),
# for example after losing the server. Then restore it with ops/restore.sh.
#
#   ops/offsite-fetch.sh            # list the backups held off-site
#   ops/offsite-fetch.sh <folder>   # download it into BACKUP_DIR/<folder> and check its checksums
#
# Settings: OFFSITE_REMOTE, RCLONE_CONFIG (an account that can read), BACKUP_DIR (default /backups).
set -euo pipefail
umask 077

die() { echo "offsite-fetch: $*" >&2; exit 1; }
[[ -n "${OFFSITE_REMOTE:-}" ]] || die "OFFSITE_REMOTE must be set"
[[ -n "${RCLONE_CONFIG:-}" && -s "${RCLONE_CONFIG}" ]] || die "RCLONE_CONFIG must point to a non-empty file"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
export RCLONE_CONFIG

if [[ $# -eq 0 ]]; then
  rclone lsf --dirs-only "$OFFSITE_REMOTE" | sed 's#/$##' | sort
  exit 0
fi
folder="$1"
[[ "$folder" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || die "not a backup folder name: $folder"
target="$BACKUP_DIR/$folder"
[[ ! -e "$target" ]] || die "$target already exists; not overwritten"
mkdir -p "$target"
rclone copy --retries 5 "$OFFSITE_REMOTE/$folder" "$target"
(cd "$target" && sha256sum --check --quiet SHA256SUMS) || die "the downloaded backup is damaged"
echo "offsite-fetch: $folder downloaded and checked -> $target"
