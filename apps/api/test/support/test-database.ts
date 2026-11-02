import { randomBytes } from 'node:crypto';
import { createPool, runMigrations } from '@constitution/db';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/**
 * Creates a brand-new, fully migrated database for one test file, so test files never
 * share data. Requires TEST_DATABASE_URL (a server where the user may create databases).
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is not set');
  }
  const admin = createPool({ connectionString: testDatabaseUrl, maxConnections: 1 });
  const name = `ci_test_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);

  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const migrationPool = createPool({ connectionString: url.toString(), maxConnections: 1 });
  try {
    await runMigrations(migrationPool);
  } finally {
    await migrationPool.end();
  }

  return {
    url: url.toString(),
    async drop() {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
