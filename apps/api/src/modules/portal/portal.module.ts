import { Module } from '@nestjs/common';
import { ConstitutionsModule } from '../constitutions/constitutions.module';
import { FilesModule } from '../files/files.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { PortalController, PublicPortalController } from './portal.controller';
import { PortalService } from './portal.service';

/** Organisation portals: public branding for sign-in pages and the signed-in portal home. */
@Module({
  imports: [OrganisationsModule, ConstitutionsModule, FilesModule],
  controllers: [PublicPortalController, PortalController],
  providers: [PortalService],
})
export class PortalModule {}
