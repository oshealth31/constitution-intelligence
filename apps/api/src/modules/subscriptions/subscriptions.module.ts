import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { LimitsService } from './limits.service';
import { PlatformBillingController } from './platform-billing.controller';
import { PlatformBillingService } from './platform-billing.service';

/**
 * Subscriptions and entitlements. The access rules themselves are enforced by PermissionGuard
 * (see access.ts); LimitsService is global so any module can check a usage limit.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [BillingController, PlatformBillingController],
  providers: [BillingService, LimitsService, PlatformBillingService],
  exports: [LimitsService, PlatformBillingService],
})
export class SubscriptionsModule {}
