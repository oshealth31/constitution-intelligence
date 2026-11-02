/** Injection token for the shared PostgreSQL connection pool. */
export const DATABASE_POOL = Symbol('DATABASE_POOL');

/** Injection token for the type-safe Drizzle database handle (see `Database` in @constitution/db). */
export const DRIZZLE = Symbol('DRIZZLE');
