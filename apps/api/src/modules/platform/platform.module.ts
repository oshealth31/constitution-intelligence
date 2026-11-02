import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganisationsModule } from '../organisations/organisations.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/** Platform Super Admin operations. */
@Module({
  imports: [AuthModule, OrganisationsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
