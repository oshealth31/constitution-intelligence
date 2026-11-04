import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { PlatformController } from './platform.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformService } from './platform.service';
import { OrganisationDeletionService } from './organisation-deletion.service';
import { FileQuarantineService } from './file-quarantine.service';
import { DataRequestsService } from './data-requests.service';

/** Platform Super Admin operations. */
@Module({
  imports: [AuthModule, OrganisationsModule, FilesModule],
  controllers: [PlatformController],
  providers: [
    PlatformService,
    PlatformDashboardService,
    OrganisationDeletionService,
    FileQuarantineService,
    DataRequestsService,
  ],
  exports: [PlatformService, OrganisationDeletionService, DataRequestsService],
})
export class PlatformModule {}
