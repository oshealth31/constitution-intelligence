# Logging, health checks, monitoring and alerting

## Logs

| Source | Format | Contains | Never contains |
| --- | --- | --- | --- |
| API (`api` container) | One JSON object per line (pino): time, level, request ID, method, **path without query string**, status, duration | Requests, warnings, errors with request IDs | Headers, cookies, passwords, tokens, API keys, question text, search words |
| Web app (`web`) | Next.js output | Start-up and server errors | Request bodies |
| Caddy (`caddy`) | JSON access log | Visitor address, path, status, size, timing | Cookies (Caddy does not log them) |
| PostgreSQL (`postgres`) | Text | Connections (`log_connections=on`), errors | Query values (statement logging is off) |
| Audit log (database table) | Rows in `audit_events` | Who did what, when, from where | Passwords; unknown sign-in emails are masked |

Production settings (`api.env`): `LOG_LEVEL=info`, `LOG_PRETTY=false`. The API refuses to start in
production with `debug` or `trace`. Every error page and API error carries a request ID, which
matches the log line: ask users for it when they report a problem.

**Retention.** On the server, Docker keeps at most 10 × 20 MB per service (rotated). For longer
retention and searching, ship the container logs to a log store in the same jurisdiction
(for example Grafana Loki or OpenSearch run in-country). Proposed retention, to be confirmed
in the data-protection review: application and proxy logs **90 days**, audit log **for the life
of the organisation's account plus the retention period** (it is part of the organisation's data).

## Health checks

| Check | Address | Healthy | Used by |
| --- | --- | --- | --- |
| Web app alive | `GET /api/health` | 200 | Docker health check, uptime monitor |
| API alive | `GET /api/v1/health/live` | 200 | Docker health check |
| API ready (database reachable) | `GET /api/v1/health/ready` | 200 (503 when the database is down; no error details) | Uptime monitor, deploy step |
| Platform health | Control Centre → System health | database, migrations, storage "Operational" | Daily look by the operator |
| Outside-in | `ops/check-health.sh https://<address>` | exit 0 | Cron on another machine, after every deploy |

Docker restarts a container whose health check fails three times (`restart: unless-stopped`).

## Monitoring and alerting

Nothing is monitored yet: there is no server. Set up at deployment, before the first
organisation goes live:

1. **Uptime monitor** outside the server, every minute: `/api/health` and `/api/v1/health/ready`.
   These pages hold no personal data, so an external service may be used.
2. **`ops/check-health.sh` daily** from cron on a second machine: catches the certificate
   expiring within 14 days and a broken HTTPS redirect.
3. **Server metrics**: disk, memory and CPU, from the host or the provider's console.
4. **Log alerts** in the log store, with these starting thresholds:

| Alert | Condition | Severity | First response |
| --- | --- | --- | --- |
| Site down | Uptime check fails 3 times in a row | Critical | [incident-response.md](incident-response.md) |
| Database not ready | `/health/ready` 503 for 2 minutes | Critical | Check `postgres` container, disk space |
| Server errors | More than 5 responses with status ≥ 500 in 5 minutes | High | Find the request IDs in the API log |
| Sign-in attack | More than 50 `auth.login.failed` or any `auth.login.rate_limited` burst (> 20 in 10 minutes) | High | Check addresses in the audit log; block at the firewall if one source |
| Request flood | More than 200 responses with status 429 in 5 minutes | Medium | Same as above |
| Disk | Above 80% | High | Old backups, logs; grow the disk |
| Certificate | Fewer than 14 days left | High | Check Caddy logs; port 80 reachable |
| Backup missing | No new backup folder in 26 hours, or the backup job exits non-zero | High | Run it by hand; see [backup-and-restore.md](backup-and-restore.md) |
| Support access | Any `support.content_accessed` audit event | Info | Confirm it matches a support ticket |

Alerts go to two named people by email and SMS/WhatsApp. Somebody must be able to act within
4 hours on working days. That service level is still to be agreed (see production-readiness.md).
