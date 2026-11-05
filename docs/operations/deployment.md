# Deployment

How to install Constitution Intelligence on a server for **staging** or **production**.

**For the Oracle Cloud server, use [oracle-cloud.md](oracle-cloud.md)**: the Deploy workflow
does sections 1–4 and 6 below from GitHub (Task S2). This page is the manual procedure it
follows, for any other server.
Nothing is deployed automatically: every step below is run by a named person, and production
needs the owner's written approval (see [production-readiness.md](production-readiness.md)).

## Layout

```
internet ──HTTPS 443──> Caddy ──> web (Next.js, port 3000) ──/api/v1──> API (NestJS, port 4000)
                                                                           │ TLS
                                                                           ▼
                                                                 PostgreSQL 16 + pgvector
                                                      uploaded files: Docker volume "storage"
```

- One server (virtual machine) with Docker Engine and the Compose plugin. 2 vCPU, 4 GB RAM and
  40 GB disk are enough for the first organisations. Hosting must satisfy the Botswana Data
  Protection Act (see the open requirements in production-readiness.md).
- Only ports **80 and 443** are open to the internet. SSH (22) only from named administrators'
  addresses, with keys, no passwords. The API and database have no published ports and sit on
  internal Docker networks.
- Files: `infra/production/` (Compose file, Caddyfile, settings template, database start-up
  script, secrets folder) and `ops/` (backup, restore, export, health check scripts).

## 1. Prepare the server (once)

1. Create an operating-system account for deployments (not root); add it to the `docker` group.
2. Firewall: allow 80/tcp and 443/tcp from anywhere, 22/tcp from administrators only; deny the rest.
3. Turn on automatic security updates for the operating system.
4. Point the DNS name (for example `portal.example.co.bw`) at the server's public address.
5. Copy `infra/production/` and `ops/` from the release to `/srv/constitution/` on the server.

## 2. Secrets and settings (once, then when rotating)

Follow [secrets.md](secrets.md) to create the files in `/srv/constitution/infra/production/secrets/`.
Then create `api.env` from `api.env.example` and fill in the real address:
`CORS_ORIGINS` and `WEB_BASE_URL` = `https://<your address>`. **Never copy values from a
development `.env` file**: production uses its own passwords, keys and certificates, generated
on or for the server. The API checks its settings at start-up and refuses to start with unsafe
values (no database TLS, plain-HTTP addresses, test AI mode, log-only email, debug logging,
relative storage path).

Create `/srv/constitution/infra/production/.env` (Compose variables, not secret):

```
SITE_ADDRESS=portal.example.co.bw
API_IMAGE=constitution-api:<git-sha>
WEB_IMAGE=constitution-web:<git-sha>
OPS_IMAGE=constitution-ops:<git-sha>
```

## 3. Build the images for a release

On a build machine (or the server), from a clean checkout of the approved commit:

```bash
sha=$(git rev-parse --short HEAD)
docker build -f infra/production/Dockerfile --target api -t constitution-api:$sha .
docker build -f infra/production/Dockerfile --target web -t constitution-web:$sha \
  --build-arg API_INTERNAL_URL=http://api:4000 .
docker build -f infra/production/Dockerfile --target ops -t constitution-ops:$sha .
```

Images are tagged with the commit, never `latest`, so every running version can be traced
and the previous one is still there for a rollback. They contain no secrets and run as the
unprivileged `node` user (checked by the deployment check workflow). If built elsewhere, move
them with `docker save | gzip` / `docker load`, or a private registry.

## 4. First start

```bash
cd /srv/constitution/infra/production
docker compose up -d --wait postgres                 # creates the database and application account
docker compose --profile migrate run --rm migrate    # applies the database migrations
docker compose up -d --wait api web caddy            # starts the application and HTTPS
bash ../../ops/check-health.sh https://portal.example.co.bw
```

Then create the first Platform Super Admin. This prints a one-time link; no password is set
or shown by the script:

```bash
docker compose run --rm -T api node dist/cli/create-super-admin.js --email <named.person@...> --name "<Full Name>"
```

(See `apps/api/src/cli/create-super-admin.ts` for its options; add `--send-email` to email the link
instead of printing it.) The person opens the link and
chooses their own password. At their first sign-in the Control Centre asks them to set up
**two-step sign-in** with an authenticator app (required for Super Admins) and shows 10 recovery
codes to keep somewhere safe. Create a second Super Admin early, so that one can reset the
other's two-step sign-in after a lost phone. Do **not** run `seed-dev`: it refuses to run outside local
development, and its fictional accounts must never exist in production.

## 5. HTTPS requirements

- Caddy obtains and renews a certificate from Let's Encrypt automatically (port 80 must be
  reachable for the challenge) and redirects HTTP to HTTPS.
- HTTPS-only for a year is announced three times over: Caddy, the web app and the API all send
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Only enable `preload` once
  every sub-domain is HTTPS for good.
- In staging and production the session cookie is `__Host-ci_session` (Secure, HttpOnly,
  SameSite=Lax), so it is never sent over plain HTTP.
- The API talks to the database over TLS and verifies its certificate (`DATABASE_SSL=true`,
  `NODE_EXTRA_CA_CERTS` = the database's certificate authority).
- `TRUST_PROXY=2`: the API trusts exactly two proxies (Caddy, then the web app) when reading the
  visitor's address. If a load balancer or CDN is added in front of Caddy, it becomes 3 and
  Caddy must be told to trust that balancer's addresses. Wrong values make every visitor share
  one address (and one sign-in limit), or let visitors fake their address.
- Check after any change: `ops/check-health.sh https://<address>` (redirect, HSTS, certificate
  expiry) and an external test such as SSL Labs (grade A expected).

## 5a. Email (invitations and password resets)

Production refuses to start without real email (`MAIL_TRANSPORT=smtp`). With Brevo (free plan:
300 emails a day):

1. Create the Brevo account (owner's decision on the provider and data transfer: see
   production-readiness.md). In **Senders, domains**: add the sending domain and publish the
   DNS records Brevo shows (DKIM, and the Brevo code), plus SPF and a DMARC record
   (start with `v=DMARC1; p=none; rua=mailto:<your address>`). Wait until Brevo shows the domain
   as authenticated.
2. **SMTP & API → SMTP**: note the login and create an SMTP key. Put the key in
   `secrets/smtp_password` ([secrets.md](secrets.md)); put the login in `SMTP_USER` and the
   sender (`MAIL_FROM`, on the verified domain) in `api.env`.
3. `docker compose up -d --wait api`, then send a test email:
   `docker compose run --rm -T api node dist/cli/send-test-email.js --to <your address>`
   (before the server exists, the **Email live test** workflow on GitHub does the same). Then **test**: use "Forgot password" for a test account,
   and check that the email arrives (inbox, not spam), that both the plain-text and formatted
   versions look right, and that **the link points directly to `https://<your address>/…`**. If
   the link has been rewritten to go through the provider (link tracking), one-time links pass
   through a third party: turn link and open tracking off in the Brevo account before go-live,
   and test again.
4. If sending fails, the action still completes: the invitation exists and the Owner sees
   "the email could not be sent" (invite again to resend); password resets answer the same as
   always. The API log shows `Email could not be sent` with an error code, never the message,
   the address or the password.

The API reaches the SMTP server through the `egress` network, its only route to the internet.
Optionally limit outgoing traffic on the server firewall to the SMTP host on port 587.

## 6. Releasing a new version

1. CI is green for the commit, including **Deployment check**; the release notes say whether
   the version contains database migrations.
2. Take a backup (`docker compose --profile ops run --rm ops`) and confirm it finished.
3. Build and tag the new images (step 3), then set the new tags in `.env`.
4. `docker compose --profile migrate run --rm migrate`
5. `docker compose up -d --wait api web` (Caddy keeps running)
6. `ops/check-health.sh`, sign in as a test account, open a constitution.
7. Record the version, time and person in the change log. If anything is wrong: [rollback.md](rollback.md).

Expect a short interruption (seconds) while containers restart. Announce maintenance windows
to organisations in advance for releases with migrations.

## What was checked automatically

The **Deployment check** workflow (`.github/workflows/deployment-check.yml`) does steps 2–4 on
a throwaway runner with generated secrets, on every pull request and weekly, then checks:
HTTPS and the redirect, security headers, both health checks, the visitor address through
both proxies, that migrations run as the migration account and the application's account is
not a superuser, owns no table and cannot alter or empty the audit log, that unsafe
settings stop the API, that the development seed refuses, and the backup and restore test.
It does **not** prove anything about a real server, its network or its hosting provider.
