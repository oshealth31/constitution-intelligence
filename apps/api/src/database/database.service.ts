import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { pingDatabase } from '@constitution/db';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Pool } from 'pg';
import { DATABASE_POOL } from './database.constants';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private closed = false;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @InjectPinoLogger(DatabaseService.name) private readonly logger: PinoLogger,
  ) {
    this.pool.on('error', (error) => {
      this.logger.error({ err: error }, 'Idle database connection failed');
    });
  }

  /** True when the database answers a trivial query within the timeout. */
  async isHealthy(): Promise<boolean> {
    try {
      await pingDatabase(this.pool);
      return true;
    } catch (error) {
      this.logger.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'Database health check failed',
      );
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }
}
