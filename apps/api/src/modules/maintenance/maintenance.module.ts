import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';

/** Scheduled housekeeping (Task D6). */
@Module({
  providers: [CleanupService],
  exports: [CleanupService],
})
export class MaintenanceModule {}
