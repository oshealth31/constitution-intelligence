import { Global, Module } from '@nestjs/common';
import { AuditSealService } from './audit-seal.service';
import { AuditService } from './audit.service';

/** Append-only audit trail, available to every module, and its daily seal (Task D12). */
@Global()
@Module({
  providers: [AuditService, AuditSealService],
  exports: [AuditService, AuditSealService],
})
export class AuditModule {}
