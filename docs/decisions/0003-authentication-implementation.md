# 0003 — Authentication built on vetted primitives; hand-written migrations

- **Status:** Accepted (Stage 3)
- **Context:** The Stage 1 plan proposed the Better Auth library, "to be verified before committing".
  Our requirements are specific: per-organisation roles with escalation rules, invitation-only
  onboarding, platform staff with no implicit tenant access, database-backed brute-force limits,
  audit events for every security decision, and (next) PostgreSQL Row-Level Security.
- **Decision:** Implement authentication in the API's own modules using well-established primitives
  rather than a framework:
  - Argon2id password hashing (`@node-rs/argon2`, OWASP parameters);
  - opaque, random 256-bit session tokens in HttpOnly cookies, stored only as SHA-256 hashes;
  - server-side sessions in PostgreSQL (instant revocation);
  - roles and permissions defined once in `packages/shared/src/access.ts`.
    Database migrations are written by hand in SQL, because security features (triggers, Row-Level
    Security policies, append-only audit) must be explicit and reviewable. Drizzle table definitions
    mirror the SQL for type-safe queries; `drizzle-kit generate` is no longer used.
- **Consequences:** No third-party auth service or per-user fees; full control of every rule; all
  behaviour is covered by our own tests. We own the maintenance of this code, so it is kept small and
  documented in `docs/security/authentication.md`. Two-factor authentication must be added by us
  (planned for the hardening stage).
