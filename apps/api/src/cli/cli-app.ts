import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadLocalEnv } from '@constitution/shared';
import { AppModule } from '../app.module';
import { loadConfig, type AppConfig } from '../config/config';

/** Starts the application without a web server, for command-line maintenance tasks. */
export async function createCliContext(): Promise<{ app: INestApplicationContext; config: AppConfig }> {
  loadLocalEnv();
  const config = loadConfig({ ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn', LOG_PRETTY: 'false' });
  const app = await NestFactory.createApplicationContext(AppModule.register(config), {
    logger: ['error', 'warn'],
  });
  return { app, config };
}

/** Reads `--name value` from the command line. */
export function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
