import { Controller, Get, INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config/config';

/** A route that fails on purpose, to prove internal errors are not leaked. */
@Controller('test-errors')
class FailingController {
  @Get('crash')
  crash(): never {
    throw new Error('Sensitive internal detail: connection string postgres://secret');
  }
}

async function startApp(databaseUrl: string): Promise<INestApplication> {
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: 'http://localhost:3000',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
    controllers: [FailingController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return app;
}

// Port 1 refuses connections immediately: simulates the database being down.
const UNREACHABLE_DATABASE = 'postgresql://nobody:nothing@127.0.0.1:1/none';

describe('API with the database unavailable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApp(UNREACHABLE_DATABASE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live reports the process is running', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'api' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/v1/health/ready returns 503 without exposing error details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);

    expect(response.body).toMatchObject({
      status: 'unavailable',
      checks: { database: 'unavailable' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|nobody/);
  });

  it('returns a consistent JSON error with a request ID for unknown routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.body.error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('hides internal details of unexpected errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/test-errors/crash')
      .expect(500);

    expect(response.body.error).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it('reuses a safe incoming request ID and replaces an unsafe one', async () => {
    const safe = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', 'support-ticket-12345');
    expect(safe.headers['x-request-id']).toBe('support-ticket-12345');

    const unsafe = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('x-request-id', '<script>alert(1)</script>');
    expect(unsafe.headers['x-request-id']).not.toContain('<script>');
  });

  it('sends security headers and hides the server technology', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the configured web origin and no other', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const blocked = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Runs against a real PostgreSQL server when TEST_DATABASE_URL is set
// (always in CI; locally after `pnpm db:up`).
describe.runIf(Boolean(testDatabaseUrl))('API with a real database', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await startApp(testDatabaseUrl!);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/ready returns 200 when the database is reachable', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });
});
