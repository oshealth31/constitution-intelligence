// Task D4: the production layout of database accounts, tested against a real PostgreSQL.
// A migration account owns the tables and applies the migrations; the application account
// (a member of app_runtime) can read and write data but owns nothing, so it cannot change the
// structure, empty tables or switch off triggers such as the audit log's append-only rule.
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate';
import { createPool } from '../src/pool';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// Reused between runs (roles belong to the whole server); the database is new each run.
const MIGRATOR = 'ci_test_migrator';
const RUNTIME = 'ci_test_runtime';

function urlFor(user: string, password: string, database: string): string {
  const url = new URL(testDatabaseUrl!);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** The database's own message (or "ok" when the statement worked). */
async function outcome(pool: Pool, statement: string): Promise<string> {
  try {
    await pool.query(statement);
    return 'ok';
  } catch (error) {
    return (error as Error).message;
  }
}

describe.runIf(Boolean(testDatabaseUrl))('separate database accounts', () => {
  const databaseName = `ci_accounts_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  let admin: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    admin = createPool({ connectionString: testDatabaseUrl!, maxConnections: 1 });
    // What infra/production/postgres-init/01-application-accounts.sh does on a new server.
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${MIGRATOR}') THEN
          CREATE ROLE ${MIGRATOR} LOGIN CREATEROLE NOSUPERUSER NOCREATEDB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
          CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME}') THEN
          CREATE ROLE ${RUNTIME} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;
        END IF;
        -- On a new server the migration account creates app_tenant itself; on this shared test
        -- server it may exist already, so it is given the right to grant it.
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
          CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$`);
    await admin.query(`ALTER ROLE ${MIGRATOR} PASSWORD '${password}'`);
    await admin.query(`ALTER ROLE ${RUNTIME} PASSWORD '${password}'`);
    await admin.query(`GRANT app_tenant TO ${MIGRATOR} WITH ADMIN OPTION`);
    await admin.query(`GRANT app_runtime TO ${RUNTIME}`);
    await admin.query(`CREATE DATABASE "${databaseName}" OWNER ${MIGRATOR}`);

    const setup = createPool({
      connectionString: urlFor(new URL(testDatabaseUrl!).username, new URL(testDatabaseUrl!).password, databaseName),
      maxConnections: 1,
    });
    await setup.query(`ALTER SCHEMA public OWNER TO ${MIGRATOR}`);
    await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await setup.query('CREATE EXTENSION IF NOT EXISTS vector');
    await setup.end();

    const migrator = createPool({
      connectionString: urlFor(MIGRATOR, password, databaseName),
      maxConnections: 1,
    });
    await runMigrations(migrator);
    await migrator.end();

    runtime = createPool({ connectionString: urlFor(RUNTIME, password, databaseName), maxConnections: 1 });
  });

  afterAll(async () => {
    await runtime?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin?.end();
  });

  it('the migration account owns the tables; the application account owns nothing', async () => {
    const owners = await runtime.query<{ owner: string; n: string }>(`
      SELECT pg_get_userbyid(c.relowner) AS owner, count(*)::text AS n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'S', 'v')
      GROUP BY 1`);
    expect(owners.rows.map((row) => row.owner)).toEqual([MIGRATOR]);
    const flags = await runtime.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
      'SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    expect(flags.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false });
  });

  it('the application account can do its work', async () => {
    expect(
      await outcome(runtime, `INSERT INTO organisations (slug, name) VALUES ('accounts-test', 'Accounts Test (fictional)')`),
    ).toBe('ok');
    expect(await outcome(runtime, `UPDATE organisations SET name = 'Renamed (fictional)' WHERE slug = 'accounts-test'`)).toBe('ok');
    expect(
      await outcome(runtime, `INSERT INTO audit_events (action, outcome) VALUES ('test.event', 'success')`),
    ).toBe('ok');
    expect(await outcome(runtime, 'SELECT count(*) FROM audit_events')).toBe('ok');
    expect(await outcome(runtime, 'SELECT count(*) FROM drizzle.__drizzle_migrations')).toBe('ok');
    // Platform queries see every organisation; organisation work switches to the tenant role.
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_tenant');
      const visible = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM organisations');
      expect(visible.rows[0]!.n).toBe(0); // no organisation set: row-level security shows nothing
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('the application account cannot change the audit log, the structure or the rules', async () => {
    expect(await outcome(runtime, `UPDATE audit_events SET action = 'changed'`)).toMatch(/permission denied/);
    expect(await outcome(runtime, 'DELETE FROM audit_events')).toMatch(/append-only/);
    expect(await outcome(runtime, 'TRUNCATE audit_events')).toMatch(/permission denied/);
    expect(
      await outcome(runtime, 'ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update_or_delete'),
    ).toMatch(/must be owner/);
    expect(await outcome(runtime, 'DROP TABLE organisations CASCADE')).toMatch(/must be owner/);
    expect(await outcome(runtime, 'ALTER TABLE users DISABLE ROW LEVEL SECURITY')).toMatch(/must be owner/);
    expect(await outcome(runtime, 'CREATE TABLE sneaky (id int)')).toMatch(/permission denied/);
    expect(await outcome(runtime, 'DROP FUNCTION prevent_audit_event_changes() CASCADE')).toMatch(/must be owner/);
    expect(await outcome(runtime, 'CREATE ROLE sneaky_role')).toMatch(/permission denied/);
  });

  it('gives the application role exactly the expected rights on every table', async () => {
    const result = await runtime.query<{
      name: string;
      s: boolean;
      i: boolean;
      u: boolean;
      d: boolean;
      t: boolean;
      x: boolean;
      r: boolean;
    }>(`
      SELECT c.relname AS name,
             has_table_privilege('app_runtime', c.oid, 'SELECT') AS s,
             has_table_privilege('app_runtime', c.oid, 'INSERT') AS i,
             has_table_privilege('app_runtime', c.oid, 'UPDATE') AS u,
             has_table_privilege('app_runtime', c.oid, 'DELETE') AS d,
             has_table_privilege('app_runtime', c.oid, 'TRUNCATE') AS t,
             has_table_privilege('app_runtime', c.oid, 'TRIGGER') AS x,
             has_table_privilege('app_runtime', c.oid, 'REFERENCES') AS r
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`);
    expect(result.rows.length).toBeGreaterThan(20);
    for (const row of result.rows) {
      const expected = {
        s: true,
        i: true,
        u: row.name !== 'audit_events',
        d: true,
        t: false,
        x: false,
        r: false,
      };
      const { name: _name, ...actual } = row;
      expect(actual, row.name).toEqual(expected);
    }
  });
});
