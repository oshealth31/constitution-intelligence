# Configuration

All settings come from **environment variables**. The API validates them when it starts
and refuses to start if anything is missing or unsafe, listing the problem settings by name
(values are never printed).

## Where settings come from

| Environment          | Source                                                                                | Notes                                                    |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Local development    | `.env` (root) and `apps/web/.env.local`                                               | Copied from the `.example` files. Never committed.       |
| Automated tests      | Set by the test code; `TEST_DATABASE_URL` from `.env` locally or from the CI workflow | Separate test database.                                  |
| Staging / production | The hosting provider's secret manager / environment settings                          | `.env` files are **ignored** when `NODE_ENV=production`. |

## API and database settings (root `.env`)

| Variable                                                             | Required                      | Default                  | Description                                                                                                                                             |
| -------------------------------------------------------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                           | No                            | `development`            | `development`, `test` or `production`.                                                                                                                  |
| `APP_ENV`                                                            | No                            | `local`                  | Where this copy runs: `local`, `test`, `staging`, `production`.                                                                                         |
| `APP_VERSION`                                                        | No                            | `0.1.0`                  | Shown by the liveness check; set by the deployment pipeline.                                                                                            |
| `API_HOST`                                                           | No                            | `127.0.0.1`              | Network address to listen on. Use `0.0.0.0` inside containers.                                                                                          |
| `API_PORT`                                                           | No                            | `4000`                   | Port the API listens on.                                                                                                                                |
| `CORS_ORIGINS`                                                       | In staging/production         | _(none)_                 | Comma-separated web origins allowed to call the API from a browser.                                                                                     |
| `TRUST_PROXY`                                                        | No                            | `false`                  | Number of trusted proxies in front of the API (`true` = 1). Production layout (HTTPS proxy → web app → API): `2`.                                       |
| `LOG_LEVEL`                                                          | No                            | `info`                   | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                                           |
| `LOG_PRETTY`                                                         | No                            | `false`                  | Human-readable logs for local development.                                                                                                              |
| `DATABASE_URL`                                                       | **Yes**                       | —                        | PostgreSQL connection string. Contains a password: treat as a secret.                                                                                   |
| `DATABASE_SSL`                                                       | In staging/production         | `false`                  | Require an encrypted, certificate-verified database connection.                                                                                         |
| `DATABASE_POOL_MAX`                                                  | No                            | `10`                     | Maximum open database connections per API instance.                                                                                                     |
| `WEB_BASE_URL`                                                       | In staging/production (https) | `http://localhost:3000`  | Web app address used in emailed links.                                                                                                                  |
| `SESSION_IDLE_MINUTES`                                               | No                            | `1440`                   | Sign-out after this long without activity.                                                                                                              |
| `SESSION_ABSOLUTE_HOURS`                                             | No                            | `336`                    | Maximum session length, even when active.                                                                                                               |
| `PASSWORD_RESET_TTL_MINUTES`                                         | No                            | `30`                     | Lifetime of a password-reset link.                                                                                                                      |
| `INVITATION_TTL_HOURS`                                               | No                            | `168`                    | Lifetime of an invitation link.                                                                                                                         |
| `AUTH_RATE_LIMIT_WINDOW_MINUTES`                                     | No                            | `15`                     | Brute-force counting window.                                                                                                                            |
| `LOGIN_MAX_ATTEMPTS_PER_EMAIL`                                       | No                            | `5`                      | Sign-in attempts per email address per window.                                                                                                          |
| `LOGIN_MAX_ATTEMPTS_PER_IP`                                          | No                            | `50`                     | Sign-in attempts per network address per window.                                                                                                        |
| `API_RATE_LIMIT_PER_MINUTE`                                          | No                            | `600`                    | Requests per minute from one network address, per copy of the API (health checks not counted). Over the limit: 429.                                     |
| `SUPER_ADMIN_SESSION_IDLE_MINUTES`                                   | No                            | `30`                     | Platform Super Admins are signed out after this long without activity.                                                                                  |
| `SUPER_ADMIN_SESSION_ABSOLUTE_HOURS`                                 | No                            | `12`                     | Platform Super Admins are always signed out after this long.                                                                                            |
| `MAIL_TRANSPORT`                                                     | In production (`smtp`)        | `log`                    | `smtp` (real email, required in production), `log` (local/test only: written to the log), `disabled` (dropped).                                         |
| `SMTP_HOST`                                                          | With `smtp`                   | —                        | The provider's SMTP server, e.g. `smtp-relay.brevo.com`.                                                                                                |
| `SMTP_PORT`                                                          | No                            | `587`                    | 587 with `starttls`, 465 with `tls`.                                                                                                                    |
| `SMTP_SECURITY`                                                      | No                            | `starttls`               | `starttls` (upgrade required, refused if the server cannot encrypt) or `tls`. There is no unencrypted option. The server certificate is always checked. |
| `SMTP_USER`                                                          | With `smtp`                   | —                        | SMTP login.                                                                                                                                             |
| `SMTP_PASSWORD` / `SMTP_PASSWORD_FILE`                               | With `smtp`                   | —                        | SMTP password or key. **Secret**: use the file form in staging and production.                                                                          |
| `MFA_ENCRYPTION_KEY` / `MFA_ENCRYPTION_KEY_FILE`                     | Staging and production        | public development key   | 64 hexadecimal characters (`openssl rand -hex 32`) that encrypt two-step sign-in secrets. **Secret**: use the file form; keep a copy offline.           |
| `CLEANUP_INTERVAL_HOURS`                                             | No                            | `6`                      | How often the API removes ended sessions, old reset links, rate-limit counters and expired two-step challenges (Task D6). `0` turns the timer off.      |
| `DOCUMENT_PARSE_TIMEOUT_SECONDS`                                     | No                            | `60`                     | Hard time limit for reading one uploaded document; the worker is stopped after it (Task D8).                                                            |
| `DOCUMENT_PARSE_MEMORY_MB`                                           | No                            | `256`                    | Memory limit of each document-reading worker.                                                                                                           |
| `DOCUMENT_PARSE_CONCURRENCY`                                         | No                            | `2`                      | Documents read at the same time per copy of the API (10 more may wait).                                                                                 |
| `SMTP_CA_FILE`                                                       | No                            | —                        | Extra certificate authority for a private SMTP relay (not needed for Brevo).                                                                            |
| `MAIL_FROM`                                                          | With `smtp`                   | —                        | Sender: `Name <address@domain>` or an address; the domain must be verified with the provider.                                                           |
| `MAIL_REPLY_TO`                                                      | No                            | —                        | Where replies go, for example the support mailbox.                                                                                                      |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`                                | No                            | `local`, `.data/storage` | Where uploaded files are kept (private; never served directly).                                                                                         |
| `DOCUMENT_MAX_BYTES`                                                 | No                            | `10485760` (10 MB)       | Largest constitution document (PDF or DOCX) accepted for upload. Up to 50 MB.                                                                           |
| `AI_PROVIDER`                                                        | No                            | `disabled`               | `disabled`, `anthropic`, or `offline` (local/test only: no AI model, quotes the best passage).                                                          |
| `ANTHROPIC_API_KEY`                                                  | When `AI_PROVIDER=anthropic`  | —                        | Secret. Used only by the API server; never sent to browsers or logged.                                                                                  |
| `AI_MODEL`                                                           | No                            | `claude-sonnet-5-5`      | Model used for answers.                                                                                                                                 |
| `AI_TIMEOUT_MS`                                                      | No                            | `30000`                  | How long to wait for the AI provider.                                                                                                                   |
| `AI_MAX_QUESTIONS_PER_USER_PER_HOUR`                                 | No                            | `30`                     | Per-person limit on questions.                                                                                                                          |
| `SUBSCRIPTION_DATA_RETENTION_DAYS`                                   | No                            | `90`                     | Days an organisation's data is kept after its access becomes restricted. See docs/subscriptions.md.                                                     |
| `BILLING_PAYMENT_INSTRUCTIONS`                                       | No                            | —                        | How to pay (e.g. bank details), shown on organisations' billing page. Not secret.                                                                       |
| `OFFLINE_COPY_MAX_AGE_DAYS`                                          | No                            | `30`                     | How long a device may show its offline copy without synchronising. See docs/offline.md.                                                                 |
| `TEST_DATABASE_URL`                                                  | For database tests            | —                        | Separate database used only by automated tests.                                                                                                         |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Local Docker only             | —                        | Used by `infra/docker-compose.yml` to create the local database.                                                                                        |

## Web settings (`apps/web/.env.local`)

| Variable                   | Required | Default                        | Description                           |
| -------------------------- | -------- | ------------------------------ | ------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | No       | `http://localhost:4000/api/v1` | API address as seen from the browser. |

**Anything starting with `NEXT_PUBLIC_` is visible to every visitor.** Never put secrets,
passwords or API keys in web settings. AI provider keys will only ever be API settings.

## Development vs production rules

These rules are enforced in code (`apps/api/src/config/config.ts`) and covered by tests:

| Rule                                                | Local / test                  | Staging / production                                        |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `.env` file loaded                                  | Yes                           | **No** (`NODE_ENV=production`)                              |
| `NODE_ENV=production` when `APP_ENV=production`     | —                             | **Required**                                                |
| Encrypted database connection (`DATABASE_SSL=true`) | Optional                      | **Required**                                                |
| Pretty logs (`LOG_PRETTY`)                          | Allowed                       | **Forbidden** (structured JSON only)                        |
| `CORS_ORIGINS`                                      | Optional                      | **Required, `https://` only**                               |
| Error responses                                     | Generic for unexpected errors | Generic for unexpected errors (details only in server logs) |

## Adding a new setting

1. Add it to the schema in `apps/api/src/config/config.ts` with a safe default or mark it required.
2. Add it, with a placeholder value and a comment, to `.env.example`.
3. Add a test in `apps/api/src/config/config.spec.ts` if it has production rules.
4. Document it in the table above.

## Secrets as files (staging and production)

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `SMTP_PASSWORD` and `MFA_ENCRYPTION_KEY` can be given as files instead: set `DATABASE_URL_FILE`
(or `ANTHROPIC_API_KEY_FILE`) to the path of a file holding the value, for example a Docker
secret at `/run/secrets/database_url`. Setting both forms is refused. See
[operations/secrets.md](operations/secrets.md).
