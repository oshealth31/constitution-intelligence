import { loadLocalEnv } from '@constitution/shared';
import { defineConfig } from 'vitest/config';

// Locally, pick up TEST_DATABASE_URL from the root .env file (never in production).
loadLocalEnv();

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
