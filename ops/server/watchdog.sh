#!/usr/bin/env bash
# Server watchdog (Task S5). Run as root every 10 minutes by constitution-watchdog.timer.
# Checks the platform from inside the server and emails the named responders when something
# goes wrong, again every 6 hours while it stays wrong, and once when it is fixed.
# The thresholds follow docs/operations/logging-and-monitoring.md.
#
# Recipients: infra/production/secrets/alert_recipients (from the GitHub secret ALERT_EMAILS,
# written by the Deploy workflow). WATCHDOG_DRY_RUN=1 prints the email instead of sending it
# (used by the deploy rehearsal). Output never contains personal data.
set -uo pipefail
root=/srv/constitution
prod="$root/infra/production"
state_dir="${WATCHDOG_STATE_DIR:-/var/lib/constitution-watchdog}"
repeat_seconds=$((6 * 3600))
max_emails_per_day=24
cd "$prod" || exit 1
install -d -m 0700 "$state_dir"

site="$(sed -n 's/^SITE_ADDRESS=//p' .env 2>/dev/null | tail -n 1)"
problems=()
problem() { problems+=("$1|$2"); }  # key|text

compose() { docker compose "$@"; }

# 1. Containers running and healthy.
for service in postgres api web caddy; do
  status="$(compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk -v s="$service" '$1 == s {print $2, $3}')"
  case "$status" in
    "running healthy" | "running ") ;;
    "") problem "container-$service" "PROBLEM: the $service container is not running." ;;
    *) problem "container-$service" "PROBLEM: the $service container is $status." ;;
  esac
done

# 2. The site answers from outside the containers, through HTTPS, with the database ready.
if [ -n "$site" ]; then
  # -k: the certificate itself is checked separately below.
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$site:443:127.0.0.1" "https://$site/api/v1/health/ready")"
  [ "$code" = 200 ] || problem site "PROBLEM: https://$site/api/v1/health/ready answers $code (expected 200)."

  # 3. Certificate: at least 14 days left.
  end="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$site" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$end" ]; then
    days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    [ "$days" -ge "${WATCHDOG_CERT_DAYS:-14}" ] || problem certificate "PROBLEM: the HTTPS certificate expires in $days days."
  else
    problem certificate "PROBLEM: the HTTPS certificate could not be read."
  fi
fi

# 4. Disk and memory.
disk_limit="${WATCHDOG_DISK_LIMIT:-80}"
disk="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
[ "${disk:-0}" -le "$disk_limit" ] || problem disk "PROBLEM: the disk is $disk% full (limit $disk_limit%)."
available="$(awk '/MemAvailable/ {a=$2} /MemTotal/ {t=$2} END {print int(a * 100 / t)}' /proc/meminfo)"
[ "${available:-100}" -ge 10 ] || problem memory "PROBLEM: only $available% of memory is free."

# 5. API log, last 10 minutes: server errors and email failures.
api_log="$(compose logs --since 10m --no-log-prefix api 2>/dev/null)"
errors="$(grep -cE '"statusCode":5[0-9]{2}' <<<"$api_log")"
[ "$errors" -le 5 ] || problem server-errors "PROBLEM: $errors server errors (status 500+) in the last 10 minutes."
mail_failures="$(grep -c 'Email could not be sent' <<<"$api_log")"
[ "$mail_failures" -eq 0 ] || problem email "PROBLEM: $mail_failures email(s) could not be sent in the last 10 minutes."
throttled="$(grep -cE '"statusCode":429' <<<"$api_log")"
[ "$throttled" -le 200 ] || problem flood "PROBLEM: $throttled requests were refused as too many in the last 10 minutes (possible flood)."

# 6. Sign-in attack, from the audit log (counts only).
failed_logins="$(compose exec -T postgres psql -U postgres -d constitution -tAc \
  "SELECT count(*) FROM audit_events WHERE action = 'auth.login.failed' AND occurred_at > now() - interval '10 minutes'" 2>/dev/null | tr -dc '0-9')"
[ "${failed_logins:-0}" -le 50 ] || problem sign-in "PROBLEM: $failed_logins failed sign-ins in the last 10 minutes (possible attack)."

# 7. Backups and the audit seal, once their timers are installed (tasks S6/S7).
if systemctl is-enabled --quiet constitution-backup.timer 2>/dev/null; then
  # Newest local backup and last good off-site copy, both within 26 hours.
  bash "$prod/systemd/check-backups.sh" > /dev/null 2>&1 ||
    problem backup "PROBLEM: no backup, or no off-site copy, in the last 26 hours."
  systemctl is-failed --quiet constitution-backup.service &&
    problem backup-job "PROBLEM: the last backup job failed."
fi
if systemctl is-enabled --quiet constitution-audit-seal.timer 2>/dev/null; then
  systemctl is-failed --quiet constitution-audit-seal.service && problem audit-seal "PROBLEM: the last daily audit seal failed."
fi

# --- Decide what to send -------------------------------------------------------------------
now=$(date +%s)
lines=()
current_keys=()
for entry in "${problems[@]}"; do
  key="${entry%%|*}" text="${entry#*|}"
  current_keys+=("$key")
  file="$state_dir/$key"
  if [ ! -f "$file" ] || [ $((now - $(cat "$file"))) -ge "$repeat_seconds" ]; then
    lines+=("$text")
    echo "$now" > "$file"
  fi
done
# Problems that were reported before and are gone now: say so once.
for file in "$state_dir"/*; do
  [ -f "$file" ] || continue
  key="$(basename "$file")"
  case "$key" in sent-*) continue ;; esac
  if ! printf '%s\n' "${current_keys[@]}" | grep -qx -- "$key"; then
    lines+=("FIXED: $key is back to normal.")
    rm -f "$file"
  fi
done

echo "$(date -u +%FT%TZ) watchdog: ${#problems[@]} problem(s), ${#lines[@]} line(s) to report."
[ "${#lines[@]}" -gt 0 ] || exit 0

today="$state_dir/sent-$(date -u +%F)"
sent_today="$(cat "$today" 2>/dev/null || echo 0)"
if [ "$sent_today" -ge "$max_emails_per_day" ]; then
  echo "Daily alert email limit reached; not sending."
  exit 0
fi
find "$state_dir" -name 'sent-*' ! -name "$(basename "$today")" -delete

if [ "${#problems[@]}" -gt 0 ]; then
  subject="Constitution Intelligence alert: ${#problems[@]} problem(s) on ${site:-the server}"
else
  subject="Constitution Intelligence: problems fixed on ${site:-the server}"
fi
body="$(printf '%s\n' "${lines[@]}")"

if [ "${WATCHDOG_DRY_RUN:-0}" = 1 ]; then
  printf 'DRY RUN, would send "%s":\n%s\n' "$subject" "$body"
  echo $((sent_today + 1)) > "$today"
  exit 0
fi
recipients="$(tr '\n' ',' < secrets/alert_recipients 2>/dev/null)"
if [ -z "${recipients//[ ,]/}" ]; then
  echo "No alert recipients set (GitHub secret ALERT_EMAILS); not sending."
  exit 0
fi
if printf '%s\n' "$body" | compose run --rm -T --no-deps api \
  node dist/cli/send-alert.js --to "$recipients" --subject "$subject"; then
  echo $((sent_today + 1)) > "$today"
else
  echo "The alert email could not be sent." >&2
  exit 1
fi
