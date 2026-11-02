import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import type { AppConfig } from './config/config';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { createLoggingModule } from './logging/logging.module';

/**
 * Root module. Feature modules (identity, tenancy, organisations, ...) are added
 * here in later stages; each lives in its own folder under src/modules.
 */
@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        createLoggingModule(config),
        DatabaseModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }
}
