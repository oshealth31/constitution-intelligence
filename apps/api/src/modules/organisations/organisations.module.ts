import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { InvitationAcceptanceController } from './invitation-acceptance.controller';
import { InvitationsService } from './invitations.service';
import { MembershipsService } from './memberships.service';
import { OrganisationProfileService } from './organisation-profile.service';
import { OrganisationsController } from './organisations.controller';

/** Organisation membership: invitations, roles, member management. */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [OrganisationsController, InvitationAcceptanceController],
  providers: [InvitationsService, MembershipsService, OrganisationProfileService],
  exports: [InvitationsService, OrganisationProfileService],
})
export class OrganisationsModule {}
