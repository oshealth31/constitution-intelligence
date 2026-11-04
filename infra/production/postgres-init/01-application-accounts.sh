#!/bin/bash
# Runs once, when the database is first created. Three kinds of account (Task D4):
#
#   constitution_owner     the container's own account: a superuser, used ONLY for
#                          administration by a person (never by the application).
#   constitution_migrator  owns the database, its schema and every table; applies migrations
#                          (the "migrate" service). Not a superuser. Used only during upgrades.
#   constitution_app       the running API, backups and exports. Owns NOTHING, so it cannot
#                          change the structure, empty tables or switch off triggers (such as
#                          the audit log's append-only rule). Gets its table rights through the
#                          app_runtime role (migration 0011). BYPASSRLS lets platform queries see
#                          every organisation; organisation work still switches to app_tenant,
#                          where row-level security applies.
set -euo pipefail
app_password="$(cat /run/secrets/app_db_password)"
migrator_password="$(cat /run/secrets/migrator_db_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$app_password" -v migrator_password="$migrator_password" <<'SQL'
CREATE ROLE constitution_migrator LOGIN CREATEROLE NOSUPERUSER NOCREATEDB PASSWORD :'migrator_password';
CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE constitution_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS
  IN ROLE app_runtime PASSWORD :'app_password';
ALTER DATABASE constitution OWNER TO constitution_migrator;
ALTER SCHEMA public OWNER TO constitution_migrator;
-- Extensions used by the migrations, created here by the administrator account.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
SQL
