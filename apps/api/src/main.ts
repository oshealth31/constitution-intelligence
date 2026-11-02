import 'reflect-metadata';
import { loadLocalEnv } from '@constitution/shared';
import { createApp } from './app.factory';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  loadLocalEnv(); // local development only; ignored when NODE_ENV=production
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.API_PORT, config.API_HOST);
}

bootstrap().catch((error: unknown) => {
  // The structured logger may not exist yet (for example, invalid configuration).
  console.error('API failed to start.', error instanceof Error ? error.message : error);
  process.exit(1);
});
