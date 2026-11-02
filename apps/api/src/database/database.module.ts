import { Global, Module } from '@nestjs/common';
import { createPool, schema, type Database } from '@constitution/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { DATABASE_POOL, DRIZZLE } from './database.constants';
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
    {
      provide: DRIZZLE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DRIZZLE, DatabaseService],
})
export class DatabaseModule {}
