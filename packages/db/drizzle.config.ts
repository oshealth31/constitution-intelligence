// Configuration for drizzle-kit (the migration generator).
// Usage (from the repository root):
//   pnpm --filter @constitution/db migration:new <name>   -> empty SQL migration to fill in by hand
//   pnpm --filter @constitution/db migration:generate     -> SQL generated from src/schema
import { loadLocalEnv } from '@constitution/shared';
import { defineConfig } from 'drizzle-kit';

loadLocalEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
