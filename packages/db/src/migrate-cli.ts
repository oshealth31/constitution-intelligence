// Command-line entry point:  pnpm db:migrate
import { loadLocalEnv } from '@constitution/shared';
import { createPool } from './pool';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exitCode = 1;
    return;
  }

  const pool = createPool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true',
    maxConnections: 1,
    applicationName: 'constitution-migrations',
  });

  try {
    await runMigrations(pool);
    console.log('Database migrations applied successfully.');
  } catch (error) {
    // Print only the message: connection errors can otherwise include connection details.
    console.error('Database migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
