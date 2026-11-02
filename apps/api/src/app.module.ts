import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import type { AppConfig } from './config/config';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { createLoggingModule } from './logging/logging.module';
import { AuthGuard } from './modules/access/auth.guard';
import { CsrfGuard } from './modules/access/csrf.guard';
import { PermissionGuard } from './modules/access/permission.guard';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConstitutionsModule } from './modules/constitutions/constitutions.module';
import { FilesModule } from './modules/files/files.module';
import { MailModule } from './modules/mail/mail.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

/**
 * Root module. Feature modules live under src/modules.
 * Global guards run on EVERY request, in this order:
 *   1. CsrfGuard       - state-changing requests must come from our web app
 *   2. AuthGuard       - a valid session is required unless the route is @Public()
 *   3. PermissionGuard - @RequireSuperAdmin() / @RequireOrgPermission() checks
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
        TenancyModule,
        AuditModule,
        MailModule,
        HealthModule,
        AuthModule,
        OrganisationsModule,
        PlatformModule,
        FilesModule,
        ConstitutionsModule,
        AiModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
