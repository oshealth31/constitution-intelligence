import { Module } from '@nestjs/common';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';

/** Offline reading: the approved content a member's device may keep. */
@Module({
  controllers: [OfflineController],
  providers: [OfflineService],
})
export class OfflineModule {}
