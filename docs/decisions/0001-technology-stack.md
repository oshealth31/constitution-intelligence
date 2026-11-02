# 0001 — Technology stack

- **Status:** Accepted (Stage 1 architecture approval, November 2026)
- **Decision:** TypeScript everywhere; Next.js + Tailwind CSS for the web front end; NestJS
  modular monolith for the API; PostgreSQL 16 (Row-Level Security, full-text search, pgvector,
  pg-boss job queue); Drizzle ORM with SQL migrations; Vitest for tests; pnpm workspaces
  monorepo; GitHub Actions for CI; Docker for local services and deployment.
- **Why:** low running cost (one database does several jobs), mainstream tools with a large
  hiring pool, strong module boundaries for a growing team, database-enforced tenant isolation,
  and no lock-in to a single hosting provider.
- **Consequences:** packages under `packages/` are compiled (CommonJS) before the API uses
  them; root scripts (`pnpm test`, `pnpm typecheck`, `pnpm dev`) do this automatically.
