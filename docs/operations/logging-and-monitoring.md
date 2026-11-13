# Logging, health checks, monitoring and alerting

## Logs

| Source                     | Format                                                                                                            | Contains                                    | Never contains                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| API (`api` container)      | One JSON object per line (pino): time, level, request ID, method, **path without query string**, status, duration | Requests, warnings, errors with request IDs | Headers, cookies, passwords, tokens, API keys, question text, search words |
| Web app (`web`)            | Next.js output                                                                                                    | Start-up and server errors                  | Request bodies                                                             |
| Caddy (`caddy`)            | JSON access log                                                                                                   | Visitor address, path, status, size, timing | Cookies (Caddy does not log them)                                          |
| PostgreSQL (`postgres`)    | Text                                                                                                              | Connections (`log_connections=on`), errors  | Query values (statement logging is off)                                    |
| Audit log (database table) | Rows in `audit_events`                                                                                            | Who did what, when, from where              | Passwords; unknown sign-in emails are masked                               |

Production settings (`api.env`): `LOG_LEVEL=info`, `LOG_PRETTY=false`. The API refuses to start in
production with `debug` or `trace`. Every error page and API error carries a request ID, which
matches the log line: ask users for it when they report a problem.

**Retention.** On the server, Docker keeps at most 10 × 20 MB per service (rotated). For longer
retention and searching, ship the container logs to a log store in the same jurisdiction
(for example Grafana Loki or OpenSearch run in-country). Proposed retention, to be confirmed
in the data-protection review: application and proxy logs **90 days**, audit log **for the life
of the organisation's account plus the retention period** (it is part of the organisation's data).

## Health checks

| Check                          | Address                                 | Healthy                                               | Used by                                     |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| Web app alive                  | `GET /api/health`                       | 200                                                   | Docker health check, uptime monitor         |
| API alive                      | `GET /api/v1/health/live`               | 200                                                   | Docker health check                         |
| API ready (database reachable) | `GET /api/v1/health/ready`              | 200 (503 when the database is down; no error details) | Uptime monitor, deploy step                 |
| Platform health                | Control Centre → System health          | database, migrations, storage "Operational"           | Daily look by the operator                  |
| Outside-in                     | `ops/check-health.sh https://<address>` | exit 0                                                | Cron on another machine, after every deploy |

Docker restarts a container whose health check fails three times (`restart: unless-stopped`).

## Monitoring and alerting (Task S5)

Three layers, all free:

| Layer               | What                                                                                                                                                                                                                               | Where                                                                                     | Who is told                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Uptime monitor**  | `/api/health` and `/api/v1/health/ready` every 5 minutes, from outside                                                                                                                                                             | UptimeRobot (free plan), set up by the owner (below)                                      | Its email and phone app                    |
| **Live site check** | `ops/check-health.sh` daily: HTTPS, HTTP→HTTPS redirect, HSTS, certificate > 14 days, API ready                                                                                                                                    | GitHub Actions, `.github/workflows/site-check.yml` (04:41 UTC)                            | GitHub emails the owner when the run fails |
| **Server watchdog** | Every 10 minutes on the server: containers, site through HTTPS, certificate, disk > 80 %, memory, server errors, email failures, request floods, failed sign-ins, and (once their timers are installed) backups and the audit seal | `ops/server/watchdog.sh`, timer `constitution-watchdog.timer`, installed by every release | Email to the named responders              |

The uptime pages hold no personal data, so an outside service may check them. The watchdog's
emails hold only counts and states, never personal data.

**Watchdog emails** go to the addresses in the GitHub secret `ALERT_EMAILS` (comma-separated,
at most 5; the Deploy workflow writes them to `secrets/alert_recipients` on the server). A new
problem is emailed at once, repeated every 6 hours while it lasts, and a "FIXED" line is sent
when it clears. At most 24 alert emails a day (Brevo's free plan allows 300). Test with the
Deploy workflow's `test-alert` task. The deploy rehearsal checks that a stopped container is
reported once, not repeated, and reported fixed.

**Setting up UptimeRobot (owner, once):**

1. Create a free account at uptimerobot.com, with two-step sign-in.
2. **Add New Monitor** → type **HTTP(s)** → name `Website`, URL
   `https://constitutionintel.com/api/health`, interval **5 minutes**.
3. Again: name `API and database`, URL `https://constitutionintel.com/api/v1/health/ready`.
4. Alert contacts: your email; install the UptimeRobot phone app for push alerts. Add the second
   responder as an alert contact.

Server metrics beyond the watchdog's disk and memory checks: Oracle Cloud console → the instance →
**Metrics**.

Not monitored yet: log shipping to a searchable store (the server keeps 5 × 20 MB per container).

The thresholds:

| Alert              | Condition                                                                                    | Severity | First response                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| Site down          | Uptime check fails 3 times in a row                                                          | Critical | [incident-response.md](incident-response.md)                                                           |
| Database not ready | `/health/ready` 503 for 2 minutes                                                            | Critical | Check `postgres` container, disk space                                                                 |
| Server errors      | More than 5 responses with status ≥ 500 in 5 minutes                                         | High     | Find the request IDs in the API log                                                                    |
| Sign-in attack     | More than 50 `auth.login.failed` or any `auth.login.rate_limited` burst (> 20 in 10 minutes) | High     | Check addresses in the audit log; block at the firewall if one source                                  |
| Request flood      | More than 200 responses with status 429 in 5 minutes                                         | Medium   | Same as above                                                                                          |
| Disk               | Above 80%                                                                                    | High     | Old backups, logs; grow the disk                                                                       |
| Certificate        | Fewer than 14 days left                                                                      | High     | Check Caddy logs; port 80 reachable                                                                    |
| Email failing      | Any `Email could not be sent` in the API log, or more than 3 in an hour                      | High     | Check the provider's status and quota (Brevo free: 300 a day), the SMTP key, the domain authentication |
| Backup missing     | No new backup folder in 26 hours, or the backup job exits non-zero                           | High     | Run it by hand; see [backup-and-restore.md](backup-and-restore.md)                                     |
| Support access     | Any `support.content_accessed` audit event                                                   | Info     | Confirm it matches a support ticket                                                                    |

Alerts go to two named people (`ALERT_EMAILS`, UptimeRobot contacts). Somebody must be able to
act within 4 hours on working days. That service level is still to be agreed (see
production-readiness.md).
