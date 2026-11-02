import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/** Folder holding the SQL migration files (works from both src/ and dist/). */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'migrations');

/**
 * Applies every migration that has not yet been applied, in order.
 * Applied migrations are recorded in the "drizzle"."__drizzle_migrations" table,
 * so running this repeatedly is safe.
 */
export async function runMigrations(
  pool: Pool,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
}
