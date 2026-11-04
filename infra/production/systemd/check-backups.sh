#!/usr/bin/env bash
# Prints the age of the newest local backup and of the last good off-site copy, and exits
# non-zero if either is older than 26 hours. For monitoring (Task D7; alerts are task S5).
set -euo pipefail
dir=/srv/constitution/infra/production/backups
limit=$((26 * 3600))
now=$(date -u +%s)
newest=$(find "$dir" -mindepth 1 -maxdepth 1 -type d -name '20*Z' -printf '%T@\n' | sort -n | tail -n 1 | cut -d. -f1)
offsite=$(cat "$dir/.offsite-last-success" 2>/dev/null || true)
offsite_s=$( [[ -n "$offsite" ]] && date -u -d "$(sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3 \4:\5:\6/' <<<"$offsite")" +%s || echo 0)
echo "newest local backup: $(( (now - ${newest:-0}) / 3600 )) hours ago"
echo "last good off-site copy: $(( (now - offsite_s) / 3600 )) hours ago"
[[ $((now - ${newest:-0})) -le $limit && $((now - offsite_s)) -le $limit ]]
