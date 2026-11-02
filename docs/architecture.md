# Architecture summary

The full, approved architecture is the **Stage 1 Architecture & Master Plan** document
(approved November 2026). This file summarises the decisions that shape the code.

## Shape

- **One codebase, one database, many organisations (tenants).** No per-organisation copies.
- **Modular monolith.** One API application split into modules with clear boundaries
  (identity, tenancy, organisations, branding, documents, processing, constitutions, review,
  search, AI, billing, audit, platform admin). Modules talk through services, never by
  reading each other's tables.
- **Worker.** The same API codebase started in a different mode runs background jobs
  (added in a later stage).
- **PostgreSQL** holds data, full-text search, embeddings (pgvector) and the job queue.
- **Tenant isolation** is enforced in the API _and_ by PostgreSQL Row-Level Security (Stage 3).

## Request path (today)

```
Browser ──HTTPS──> Web (Next.js, port 3000)
Browser ──HTTPS──> API (NestJS, port 4000, prefix /api/v1)
                     ├─ request ID + structured log (pino)
                     ├─ security headers (helmet), CORS allow-list, 1 MB body limit
                     ├─ controllers (today: health only)
                     ├─ global error filter → consistent JSON errors, no internal details
                     └─ PostgreSQL connection pool
```

## Where new code goes

| Kind of code                   | Location                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------ |
| A new API feature module       | `apps/api/src/modules/<module-name>/` (controller, service, repository, tests) |
| Database tables                | `packages/db/src/schema/` + a migration in `packages/db/migrations/`           |
| Code shared by API and scripts | `packages/shared/src/`                                                         |
| Web pages                      | `apps/web/src/app/`                                                            |
| Design tokens                  | `apps/web/src/app/globals.css` (`@theme` block)                                |

## Stage 2 deviations from the Stage 1 plan

See [decisions](decisions) for details:

- Database integration tests use a provided PostgreSQL (`TEST_DATABASE_URL`: Docker Compose
  locally, a service container in CI) instead of Testcontainers. Same real-database coverage,
  fewer moving parts.
