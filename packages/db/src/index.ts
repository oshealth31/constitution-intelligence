import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schemaModule from './schema';

export { createPool, pingDatabase } from './pool';
export type { DatabasePoolOptions } from './pool';
export { MIGRATIONS_FOLDER, runMigrations } from './migrate';
export * as schema from './schema';
export * from './schema';

/** Type-safe database handle used by the API. */
export type Database = NodePgDatabase<typeof schemaModule>;
