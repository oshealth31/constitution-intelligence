#!/usr/bin/env bash
# Constitution Intelligence: outside-in health check, for cron or an uptime monitor.
#
# Usage: ops/check-health.sh https://portal.example.co.bw
# Exit 0 when healthy, 1 otherwise; prints one line per check. Checks:
#   - the web app answers (GET /api/health)
#   - the API can reach its database (GET /api/v1/health/ready)
#   - HTTP redirects to HTTPS, and HTTPS-only (HSTS) is announced
#   - the certificate is valid for at least CERT_WARN_DAYS more days (default 14)
set -uo pipefail
site="${1:?usage: check-health.sh https://your.address}"
host="${site#https://}"; host="${host%%/*}"
warn_days="${CERT_WARN_DAYS:-14}"
failures=0
check() { # check <description> <command...>
  if "${@:2}" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; failures=$((failures + 1)); fi
}
status() { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1")" == "$2" ]]; }
hsts() { curl -sI --max-time 10 "$site/" | grep -qi '^strict-transport-security:'; }
redirect() { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$host/")" =~ ^30[178]$ ]]; }
certificate() {
  local end
  end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null |
    openssl x509 -noout -enddate | cut -d= -f2)" || return 1
  [[ -n "$end" ]] || return 1
  (( $(date -d "$end" +%s) - $(date +%s) > warn_days * 86400 ))
}
check "web app answers" status "$site/api/health" 200
check "API and database ready" status "$site/api/v1/health/ready" 200
check "HTTP redirects to HTTPS" redirect
check "HTTPS-only announced (HSTS)" hsts
check "certificate valid for more than $warn_days days" certificate
exit $(( failures > 0 ))
