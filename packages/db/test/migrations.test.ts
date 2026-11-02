import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPool } from '../src/pool';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate';

interface JournalEntry {
  idx: number;
  tag: string;
}

const journal = JSON.parse(
  fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

describe('migration files', () => {
  it('has a SQL file for every journal entry and no unlisted SQL files', () => {
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_FOLDER)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const journalFiles = journal.entries.map((entry) => `${entry.tag}.sql`).sort();
    expect(sqlFiles).toEqual(journalFiles);
  });

  it('numbers journal entries in order starting at 0', () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Integration test against a real PostgreSQL server. Runs when TEST_DATABASE_URL is set
// (always in CI; locally after `pnpm db:up`). Uses a throwaway database that is dropped afterwards.
describe.runIf(Boolean(testDatabaseUrl))('running migrations against PostgreSQL', () => {
  it('applies all migrations, is safe to re-run, and enables the required extensions', async () => {
    const admin = createPool({ connectionString: testDatabaseUrl!, maxConnections: 1 });
    const databaseName = `ci_migrations_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);

    const url = new URL(testDatabaseUrl!);
    url.pathname = `/${databaseName}`;
    const pool = createPool({ connectionString: url.toString(), maxConnections: 2 });

    try {
      await runMigrations(pool);
      await runMigrations(pool); // second run must be a no-op

      const extensions = await pool.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'vector') ORDER BY extname",
      );
      expect(extensions.rows.map((row) => row.extname)).toEqual(['pg_trgm', 'vector']);

      const applied = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
      );
      expect(applied.rows[0]?.count).toBe(String(journal.entries.length));
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });
});
