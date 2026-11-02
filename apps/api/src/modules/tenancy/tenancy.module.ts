import { Global, Module } from '@nestjs/common';
import { TenantDatabase } from './tenant-database.service';

/** Tenant isolation building blocks, available to every module. */
@Global()
@Module({
  providers: [TenantDatabase],
  exports: [TenantDatabase],
})
export class TenancyModule {}
