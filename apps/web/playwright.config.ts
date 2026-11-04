// Browser tests for the control centre and organisation portals. They run the REAL API and web app against a real
// PostgreSQL database (in CI) and drive them through Chromium.
//
// Requirements: DATABASE_URL (migrated), API and web built with API_INTERNAL_URL pointing to
// http://127.0.0.1:4100. See .github/workflows/ci.yml ("Browser tests").
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 3100;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

const apiEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NODE_ENV: 'test',
  APP_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  CORS_ORIGINS: WEB_ORIGIN,
  TRUST_PROXY: 'true',
  LOG_LEVEL: 'warn',
  LOG_PRETTY: 'false',
  MAIL_TRANSPORT: 'log',
  LOGIN_MAX_ATTEMPTS_PER_EMAIL: '100',
  // Every browser test signs in from the same address.
  LOGIN_MAX_ATTEMPTS_PER_IP: '1000',
  API_RATE_LIMIT_PER_MINUTE: '100000',
  // No AI account in CI: the offline mode quotes the best passage instead of asking a model.
  AI_PROVIDER: 'offline',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      env: apiEnv,
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: `node ./node_modules/next/dist/bin/next start --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: `${WEB_ORIGIN}/api/health`,
      env: {
        ...(process.env as Record<string, string>),
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
      },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
