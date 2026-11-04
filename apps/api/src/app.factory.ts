import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { isDeployedEnvironment, type AppConfig } from './config/config';
import { createRequestThrottle } from './common/request-throttle';

/** Creates the API application with all global settings applied. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
  });
  configureApp(app, config);
  return app;
}

/**
 * Global HTTP settings. Kept separate from createApp so automated tests run
 * the exact same configuration as the real server.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }
  app.use(
    helmet({
      // The API only returns data (JSON) and downloads: nothing in a response may run or be framed.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      // HTTPS-only for a year, once deployed (browsers ignore it on plain-HTTP local addresses).
      strictTransportSecurity: isDeployedEnvironment(config)
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
    }),
  );
  // Responses carry personal or organisation data: browsers and proxies must not store them,
  // unless a route says otherwise (for example the public portal logo).
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    createRequestThrottle({
      limit: config.API_RATE_LIMIT_PER_MINUTE,
      skipPrefixes: ['/api/v1/health/'],
    }),
  );
  app.enableCors({
    origin: config.CORS_ORIGINS.length > 0 ? [...config.CORS_ORIGINS] : false,
    credentials: true,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
}
