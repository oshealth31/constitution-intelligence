# Local development guide

This guide takes you from a new computer to a running copy of Constitution Intelligence.
Commands are typed into a terminal: **PowerShell** or **Windows Terminal** on Windows, or
**Terminal** on macOS/Linux. In VS Code you can open one with _View → Terminal_.

## 1. Install the required software (once)

| Software              | Version                 | Where to get it                                      | Check it works           |
| --------------------- | ----------------------- | ---------------------------------------------------- | ------------------------ |
| Node.js               | 22 LTS, 22.12 or newer  | <https://nodejs.org> (choose the 22.x LTS installer) | `node -v` → `v22.x.x`    |
| Git                   | 2.40 or newer           | <https://git-scm.com>                                | `git --version`          |
| Docker Desktop        | Recent, with Compose v2 | <https://www.docker.com/products/docker-desktop>     | `docker compose version` |
| VS Code (recommended) | Latest                  | <https://code.visualstudio.com>                      | —                        |

Windows notes:

- During Docker Desktop installation, keep the **"Use WSL 2"** option enabled. Restart when asked.
- Start Docker Desktop and wait until it says _Engine running_ before using the database commands.

Then enable pnpm (the package manager). The exact version (10.28.0) is pinned in
`package.json` and selected automatically:

```bash
corepack enable
pnpm -v          # should print 10.28.0
```

If `corepack enable` reports a permissions error on Windows, run the terminal once as Administrator.

## 2. Get the code and install dependencies

```bash
git clone https://github.com/oshealth31/constitution-intelligence.git
cd constitution-intelligence
pnpm install
```

## 3. Create your local settings

```bash
# macOS / Linux
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# Windows PowerShell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Open `.env` and replace **all three** occurrences of `replace-me-with-a-local-password` (in
`POSTGRES_PASSWORD`, `DATABASE_URL` and `TEST_DATABASE_URL`) with the same password of your choice.
This password only protects the database on your own computer. Do not reuse a real password.

## 4. Start the database and apply migrations

```bash
pnpm db:up        # downloads and starts PostgreSQL 16 + pgvector (first run takes a minute)
pnpm db:migrate   # prints "Database migrations applied successfully."
```

The database is only reachable from your own computer (`127.0.0.1`). Its data is kept in a
Docker volume, so it survives restarts. `pnpm db:down` stops it without deleting data.

## 5. Run the application

```bash
pnpm dev
```

| What          | Address                                     | Expected result                                  |
| ------------- | ------------------------------------------- | ------------------------------------------------ |
| Web app       | <http://localhost:3000>                     | Constitution Intelligence placeholder page       |
| Web health    | <http://localhost:3000/api/health>          | `{"status":"ok","service":"web",...}`            |
| API liveness  | <http://localhost:4000/api/v1/health/live>  | `{"status":"ok","service":"api",...}`            |
| API readiness | <http://localhost:4000/api/v1/health/ready> | `{"status":"ok","checks":{"database":"ok"},...}` |

Stop with `Ctrl + C`.

## 6. Run the checks

```bash
pnpm check
```

This runs code-quality checks (ESLint), TypeScript type checks and all automated tests.
Tests that need a database use `TEST_DATABASE_URL` (a separate `constitution_test` database
created automatically by Docker), so they never touch your development data. If
`TEST_DATABASE_URL` is not set, those tests are **skipped** and reported as skipped.

The same checks run automatically on GitHub for every change (see `.github/workflows/ci.yml`).

## Project layout

```
constitution-intelligence/
├── apps/
│   ├── api/                 NestJS API (modular monolith)
│   │   ├── src/
│   │   │   ├── main.ts               starts the server
│   │   │   ├── app.module.ts         root module (feature modules are added here)
│   │   │   ├── app.factory.ts        global HTTP settings (security headers, CORS, prefix)
│   │   │   ├── config/               environment validation
│   │   │   ├── logging/              structured JSON logging with request IDs
│   │   │   ├── common/errors/        consistent, safe error responses
│   │   │   ├── database/             PostgreSQL connection pool
│   │   │   └── health/               health-check endpoints
│   │   └── test/                     API tests (HTTP level)
│   └── web/                 Next.js web front end
│       └── src/
│           ├── app/                  pages and the /api/health route
│           └── lib/                  brand constants, public settings
├── packages/
│   ├── db/                  connection pool, migrations, migration runner
│   │   └── migrations/               SQL migration files (applied in order)
│   └── shared/              shared helpers (local .env loading)
├── infra/                   Docker Compose for local PostgreSQL
├── docs/                    documentation and decision records
└── .github/                 CI workflow and dependency updates
```

## Database migrations

A migration is a numbered SQL file in `packages/db/migrations` that changes the database
structure. They are applied in order and recorded, so each one runs exactly once.

```bash
pnpm db:migrate                                          # apply pending migrations
pnpm --filter @constitution/db migration:new add_thing   # create an empty migration to write by hand
pnpm --filter @constitution/db migration:generate        # generate SQL from the Drizzle schema (from Stage 3)
```

Rules: never edit a migration that has already been applied anywhere shared (staging,
production); add a new migration instead.

## Troubleshooting

| Problem                                                                 | Fix                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API failed to start. Invalid configuration: DATABASE_URL is required`  | Create `.env` from `.env.example` (step 3).                                                                                                                                                                                   |
| `pnpm db:up` says _Set POSTGRES_PASSWORD in .env_                       | Set `POSTGRES_PASSWORD` in `.env`.                                                                                                                                                                                            |
| `pnpm db:up` cannot connect to Docker                                   | Start Docker Desktop and wait for _Engine running_.                                                                                                                                                                           |
| Port 5432 already in use                                                | Another PostgreSQL is running. Stop it, or set `POSTGRES_PORT=5433` in `.env` and update the port in `DATABASE_URL` and `TEST_DATABASE_URL`.                                                                                  |
| Readiness shows `"database":"unavailable"`                              | Run `pnpm db:up` and check the password in `DATABASE_URL` matches `POSTGRES_PASSWORD`.                                                                                                                                        |
| Changed `POSTGRES_PASSWORD` after the first `db:up` and login now fails | The password is fixed when the database is first created. Either restore the old password, or reset local data: `docker compose --env-file .env -f infra/docker-compose.yml down -v` (deletes local data), then `pnpm db:up`. |
| `ERR_PNPM_UNSUPPORTED_ENGINE`                                           | Install Node.js 22 LTS (step 1).                                                                                                                                                                                              |
