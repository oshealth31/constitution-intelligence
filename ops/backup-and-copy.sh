#!/usr/bin/env bash
# Constitution Intelligence: the daily job (Task D7). Takes an encrypted backup, then copies
# every backup not yet off-site to the off-site location and checks the copies.
# Exit status: 0 only when both worked, so the scheduler (systemd timer or cron) can alert.
set -euo pipefail
/ops/backup.sh
if [[ -n "${OFFSITE_REMOTE:-}" ]]; then
  /ops/offsite-copy.sh
else
  echo "backup-and-copy: OFFSITE_REMOTE is not set; the backup is ONLY on this server" >&2
  exit 2
fi
