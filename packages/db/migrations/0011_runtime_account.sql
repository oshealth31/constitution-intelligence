-- Separate database accounts (Task D4, risk U3 in docs/security/security-review.md).
--
-- In production two accounts connect:
--   constitution_migrator  owns the tables and runs these migrations (upgrades only);
--   constitution_app       runs the API, backups and exports. It is a member of app_runtime,
--                          OWNS NOTHING, and so cannot drop or alter tables or switch off
--                          triggers such as the audit log's append-only rule.
-- Both accounts and app_runtime are created by infra/production/postgres-init. This migration
-- creates app_runtime if it is missing (development, tests) and grants it exactly what the
-- running application needs. Development and tests keep using a single account.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- Organisation work switches to the restricted tenant role (row-level security), as before.
GRANT app_tenant TO app_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
-- Read and write data. No TRUNCATE, no REFERENCES, no TRIGGER: none of those are needed.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
--> statement-breakpoint
-- The audit log: read and add only. DELETE stays for the organisation-deletion procedure, which
-- the append-only trigger still limits to deleted organisations and deleted accounts (0010).
REVOKE UPDATE ON audit_events FROM app_runtime;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
--> statement-breakpoint
-- Which migrations have been applied (shown on the System health page; read by backups).
GRANT USAGE ON SCHEMA drizzle TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO app_runtime;
--> statement-breakpoint
-- Tables and sequences created by later migrations get the same rights automatically. A
-- migration that needs fewer (like audit_events) revokes them itself; the tests check this.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
