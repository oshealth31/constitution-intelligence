#!/bin/bash
# Runs once, when the database is first created. The container's own account
# (constitution_owner) is a superuser and is used only for administration. The application
# gets an ordinary account that owns its database and can create the restricted tenant role
# used for row-level security, but is NOT a superuser (it cannot bypass row-level security
# for tenant work, read server files or change server settings).
set -euo pipefail
app_password="$(cat /run/secrets/app_db_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$app_password" <<'SQL'
CREATE ROLE constitution_app LOGIN CREATEROLE NOSUPERUSER NOCREATEDB PASSWORD :'app_password';
ALTER DATABASE constitution OWNER TO constitution_app;
ALTER SCHEMA public OWNER TO constitution_app;
-- Extensions used by the migrations, created here by the administrator account.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
SQL
