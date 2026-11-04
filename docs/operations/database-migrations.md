# Database migrations

The database structure is changed only by the numbered SQL files in `packages/db/migrations/`
(0000 onwards). Each is applied once, in order, and recorded in
`drizzle.__drizzle_migrations`, so running the migration command again is safe.

## Running them in production

```bash
cd /srv/constitution/infra/production
docker compose --profile ops run --rm ops                 # 1. backup first, always
docker compose --profile migrate run --rm migrate         # 2. apply new migrations
docker compose up -d --wait api web                       # 3. start the new version
```

- The `migrate` service runs `node dist/cli/migrate.js` from the **new** API image with the
  `database_migrator_url` secret (the `constitution_migrator` account, which owns the tables),
  over TLS. The API itself never uses this account.
- It prints "Database migrations applied successfully." or the error message (never the
  connection string) and exits non-zero on failure.
- All pending migrations run inside one transaction: if one fails, none of them is applied and
  the database is left as it was.

## Rules for writing migrations

1. **Forward only.** There are no "down" migrations; a mistake is fixed by a new migration, or
   by restoring the backup taken in step 1 (see [rollback.md](rollback.md)).
2. **Backward compatible where possible** ("expand, then contract"): add columns and tables
   first, release code that uses them, and remove old ones in a later release. Then the
   previous application version keeps working after the migration, and a rollback needs no restore.
3. Never edit a migration that has been applied anywhere; add a new one.
4. Every new table with organisation data needs `organisation_id`, row-level security and a
   policy for `app_tenant`; the tenancy tests list every such table and fail if one is missing.
5. Long operations on big tables (new indexes) use `CREATE INDEX CONCURRENTLY` in their own
   migration, and are announced as maintenance.
6. Test: CI applies all migrations to an empty database on every change, also as a
   non-superuser migration account with a separate application account
   (`packages/db/test/accounts.test.ts`), and the Deployment check does the same on the
   production stack.
7. New tables automatically give the application role (`app_runtime`) SELECT, INSERT, UPDATE and
   DELETE (migration 0011). If the application must not change or delete a table's rows (like
   `audit_events`), REVOKE those rights in the same migration and update the expected rights in
   `accounts.test.ts`, which checks every table.

## First installation

The first `migrate` run creates everything, including the restricted `app_tenant` role used for
row-level security, and grants the application role its rights. The three accounts
(`constitution_owner`, `constitution_migrator`, `constitution_app`) and the `app_runtime` role
are created by the database start-up script on its first start ([secrets](secrets.md#database-accounts-task-d4)).
This is for a **new** database: no production database exists yet, so there is no upgrade
procedure from the earlier single-account layout. The extensions it needs (`pg_trgm`, `vector`) are created beforehand by the
database start-up script (`infra/production/postgres-init/`) or, on a managed service, by its
administrator.

## Checking what is applied

```bash
docker compose exec -T postgres psql -U constitution_owner -d constitution \
  -c 'SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id'
```

The count must equal the number of files in `packages/db/migrations/` for the running version.
