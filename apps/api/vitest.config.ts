import { loadLocalEnv } from '@constitution/shared';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Locally, pick up TEST_DATABASE_URL from the root .env file (never in production).
loadLocalEnv();

export default defineConfig({
  // SWC compiles NestJS decorators and their type metadata (esbuild cannot).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
  },
});
