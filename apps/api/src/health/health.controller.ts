import { Controller, Get, Header, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import { DatabaseService } from '../database/database.service';

/**
 * Health checks used by the hosting platform and uptime monitoring.
 *   GET /api/v1/health/live   -> the process is running (no dependencies checked)
 *   GET /api/v1/health/ready  -> the API can serve traffic (database reachable)
 * They reveal no internal details (no versions of dependencies, no error messages).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return {
      status: 'ok',
      service: 'api',
      version: this.config.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(@Res({ passthrough: true }) response: Response) {
    const databaseOk = await this.database.isHealthy();
    if (!databaseOk) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: databaseOk ? 'ok' : 'unavailable',
      checks: { database: databaseOk ? 'ok' : 'unavailable' },
      timestamp: new Date().toISOString(),
    };
  }
}
