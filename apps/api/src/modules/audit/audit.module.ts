import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Append-only audit trail, available to every module. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
