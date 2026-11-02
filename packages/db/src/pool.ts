import { Pool } from 'pg';

export interface DatabasePoolOptions {
  connectionString: string;
  /** Maximum number of open connections in the pool. */
  maxConnections?: number;
  /** Require an encrypted (TLS) connection with certificate verification. */
  ssl?: boolean;
  /** Name shown in PostgreSQL monitoring views. */
  applicationName?: string;
  /** Called when an idle connection fails. Without a handler Node.js would crash. */
  onError?: (error: Error) => void;
}

/** Creates a PostgreSQL connection pool. Connections are opened lazily, on first use. */
export function createPool(options: DatabasePoolOptions): Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    application_name: options.applicationName ?? 'constitution-intelligence',
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', options.onError ?? (() => undefined));
  return pool;
}

/** Runs a trivial query to prove the database is reachable. Rejects on failure or timeout. */
export async function pingDatabase(pool: Pool, timeoutMs = 2_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const query = pool.query('SELECT 1');
  // If the timeout wins, the query may still fail later; swallow that late failure.
  query.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database ping timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
