import { Global, Module } from '@nestjs/common';
import { createPool } from '@constitution/db';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { DATABASE_POOL } from './database.constants';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createPool({
          connectionString: config.DATABASE_URL,
          maxConnections: config.DATABASE_POOL_MAX,
          ssl: config.DATABASE_SSL,
          applicationName: `constitution-api-${config.APP_ENV}`,
        }),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule {}
