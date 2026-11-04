#!/usr/bin/env bash
# Constitution Intelligence: thin out the off-site backups (Task D7). Keeps:
#   - the newest OFFSITE_KEEP_DAILY backups (default 35), and
#   - the newest backup of each of the last OFFSITE_KEEP_MONTHLY months (default 12).
# Everything older is removed. Without --yes it only PRINTS what it would remove.
#
#   ops/offsite-prune.sh          # show the plan
#   ops/offsite-prune.sh --yes    # remove
#
# Run it with a SEPARATE rclone configuration (RCLONE_CONFIG) whose account may delete: the
# daily copy job's account may only add files, so a stolen server cannot wipe the off-site copy.
# Alternatively, leave this out and set an expiry rule in the storage provider instead.
set -euo pipefail

die() { echo "offsite-prune: $*" >&2; exit 1; }
[[ -n "${OFFSITE_REMOTE:-}" ]] || die "OFFSITE_REMOTE must be set"
[[ -n "${RCLONE_CONFIG:-}" && -s "${RCLONE_CONFIG}" ]] || die "RCLONE_CONFIG must point to a non-empty file"
export RCLONE_CONFIG
keep_daily="${OFFSITE_KEEP_DAILY:-35}"
keep_monthly="${OFFSITE_KEEP_MONTHLY:-12}"
apply="${1:-}"

mapfile -t all < <(rclone lsf --dirs-only "$OFFSITE_REMOTE" | sed 's#/$##' | grep -E '^20[0-9]{6}T[0-9]{6}Z$' | sort -r)
[[ ${#all[@]} -gt 0 ]] || { echo "offsite-prune: no backups off-site"; exit 0; }

declare -A keep=()
for ((i = 0; i < ${#all[@]} && i < keep_daily; i++)); do keep["${all[$i]}"]=1; done
months=0
last_month=""
for folder in "${all[@]}"; do # newest first: the first one seen in a month is that month's newest
  month="${folder:0:6}"
  if [[ "$month" != "$last_month" ]]; then
    last_month="$month"
    months=$((months + 1))
    [[ $months -le $keep_monthly ]] && keep["$folder"]=1
  fi
done

removed=0
for folder in "${all[@]}"; do
  [[ -n "${keep[$folder]:-}" ]] && continue
  if [[ "$apply" == "--yes" ]]; then
    echo "offsite-prune: removing $folder"
    rclone purge "$OFFSITE_REMOTE/$folder"
  else
    echo "offsite-prune: would remove $folder"
  fi
  removed=$((removed + 1))
done
echo "offsite-prune: ${#keep[@]} kept, $removed $([[ "$apply" == "--yes" ]] && echo removed || echo 'to remove (run with --yes)')"
