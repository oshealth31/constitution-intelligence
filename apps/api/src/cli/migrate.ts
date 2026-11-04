// Production migration runner:  node dist/cli/migrate.js
// Applies every database migration that has not been applied yet, then exits.
// Uses the same settings as the API: DATABASE_URL (or DATABASE_URL_FILE) and DATABASE_SSL.
// Run it with the database OWNER account (the one allowed to change tables), before starting
// a new version of the API. See docs/operations/database-migrations.md.
import { createPool, runMigrations } from '@constitution/db';
import { loadLocalEnv } from '@constitution/shared';
import { resolveSecretFiles } from '../config/config';

async function main(): Promise<void> {
  loadLocalEnv(); // local development only; ignored when NODE_ENV=production
  const env = resolveSecretFiles(process.env);
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL (or DATABASE_URL_FILE) is not set.');
    process.exitCode = 1;
    return;
  }
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === 'true',
    maxConnections: 1,
    applicationName: 'constitution-migrations',
  });
  try {
    await runMigrations(pool);
    console.log('Database migrations applied successfully.');
  } catch (error) {
    // Only the message: connection errors can otherwise include connection details.
    console.error('Database migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
