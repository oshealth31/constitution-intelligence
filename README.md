# Constitution Intelligence

A managed, multi-tenant SaaS platform, based in Botswana, that makes organisational
constitutions easy to access, search, understand and use.

> _Empowering Your Governance, Safeguarding Your Future._

**Status:** Stage 6 — organisation portals. Each organisation has its own branded portal
(`/o/<portal address>`) for reading and searching its constitution, with an administrator area,
on top of the control centre (Stage 5), tenant isolation (Stage 4) and sign-in and roles (Stage 3).
It is **not production-ready**.

## What is in this repository

| Folder            | What it is                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Web front end (Next.js + Tailwind CSS). Member portal, organisation console and super-admin console will live here. |
| `apps/api`        | Back-end API (NestJS modular monolith). All business rules, permissions and tenant isolation are enforced here.     |
| `packages/db`     | Database connection, schema and SQL migrations (PostgreSQL + Drizzle).                                              |
| `packages/shared` | Code shared by the API and scripts (currently: local `.env` loading).                                               |
| `infra`           | Local development services (PostgreSQL with pgvector via Docker Compose).                                           |
| `docs`            | Architecture notes, decisions, development and configuration guides.                                                |
| `.github`         | Continuous integration (automatic checks on every change) and dependency updates.                                   |

## Quick start (local development)

Full step-by-step instructions, including installing the required software, are in
**[docs/development.md](docs/development.md)**.

```bash
corepack enable                 # makes the correct pnpm version available
pnpm install                    # install dependencies
cp .env.example .env            # then edit .env and set your own local password
cp apps/web/.env.example apps/web/.env.local
pnpm db:up                      # start local PostgreSQL in Docker
pnpm db:migrate                 # apply database migrations
pnpm dev                        # start the API (port 4000) and web app (port 3000)
```

Then open:

- Web app: <http://localhost:3000>
- Control centre: <http://localhost:3000/admin> (run `pnpm seed:dev` for fictional accounts)
- Organisation portals: <http://localhost:3000/o/sample-community-choir> and
  <http://localhost:3000/o/sample-netball-club> (fictional, created by `pnpm seed:dev`)
- Web health check: <http://localhost:3000/api/health>
- API liveness: <http://localhost:4000/api/v1/health/live>
- API readiness (checks the database): <http://localhost:4000/api/v1/health/ready>

## Common commands

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                    | Runs API and web app with automatic reload.                              |
| `pnpm check`                  | Lint + type-check + all tests (run before every commit).                 |
| `pnpm test`                   | All automated tests. Database tests run when `TEST_DATABASE_URL` is set. |
| `pnpm lint`                   | Code-quality checks (ESLint).                                            |
| `pnpm typecheck`              | TypeScript type checks.                                                  |
| `pnpm build`                  | Production builds of every package and app.                              |
| `pnpm format`                 | Formats code with Prettier.                                              |
| `pnpm db:up` / `pnpm db:down` | Starts / stops local PostgreSQL.                                         |
| `pnpm db:migrate`             | Applies pending database migrations.                                     |

## Required software

| Software              | Version                               | Notes                                                                           |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Node.js               | 22 LTS (22.12 or newer)               | See `.nvmrc`.                                                                   |
| pnpm                  | 10.28.0                               | Installed automatically by `corepack enable` (pinned in `package.json`).        |
| Docker Desktop        | Recent version with Docker Compose v2 | Runs the local PostgreSQL database.                                             |
| Git                   | 2.40 or newer                         | Version control.                                                                |
| VS Code (recommended) | Latest                                | Recommended extensions are suggested automatically (`.vscode/extensions.json`). |

PostgreSQL itself does not need to be installed: it runs inside Docker (PostgreSQL 16 with pgvector).

## Security rules (summary)

- Never commit `.env` or `.env.local` files; only the `*.example` files are committed.
- Never place secrets in `NEXT_PUBLIC_` variables — they are visible to every browser.
- Staging and production settings live in the hosting provider's secret manager.
- Development uses synthetic data only.

See [docs/configuration.md](docs/configuration.md) for every setting and the rules enforced
in production.

## Documentation

- [docs/development.md](docs/development.md) — local setup, running, testing, troubleshooting
- [docs/configuration.md](docs/configuration.md) — environment variables, development vs production
- [docs/architecture.md](docs/architecture.md) — architecture summary and where things go
- [docs/security/authentication.md](docs/security/authentication.md) — roles, permissions, sign-in, sessions, audit events
- [docs/security/tenant-isolation.md](docs/security/tenant-isolation.md) — how organisations are kept apart
- [docs/control-centre.md](docs/control-centre.md) — the Platform Super Admin control centre
- [docs/portals.md](docs/portals.md) — organisation portals, branding and their safety rules
- [docs/decisions](docs/decisions) — short records of major technical decisions

## Ownership

© Constitution Intelligence. All rights reserved. Proprietary software — not open source.
Organisations retain ownership of their own constitutions and documents.
