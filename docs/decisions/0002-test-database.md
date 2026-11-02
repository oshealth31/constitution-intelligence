# 0002 — Test database for integration tests

- **Status:** Accepted (Stage 2)
- **Context:** The Stage 1 plan named Testcontainers (tests start their own PostgreSQL
  container). That requires a Docker image download from inside every test run and a Docker
  daemon reachable from the test process.
- **Decision:** Integration tests connect to a PostgreSQL server given by `TEST_DATABASE_URL`:
  - locally, the `constitution_test` database created by `infra/docker-compose.yml`;
  - in CI, a `pgvector/pgvector:pg16` service container defined in `.github/workflows/ci.yml`.
  Tests that change database structure create and drop their own throwaway database.
- **Consequences:** Same real-PostgreSQL behaviour (including Row-Level Security from Stage 3)
  with a simpler setup. When `TEST_DATABASE_URL` is missing, database tests are skipped and
  reported as skipped — CI always provides it, so CI never skips them.
