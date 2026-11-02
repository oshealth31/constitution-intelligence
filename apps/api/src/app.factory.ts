import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AppConfig } from './config/config';

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
  app.use(helmet());
  app.enableCors({
    origin: config.CORS_ORIGINS.length > 0 ? [...config.CORS_ORIGINS] : false,
    credentials: true,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
}
