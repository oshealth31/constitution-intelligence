import { Controller, Get, Header, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/request-context';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { OfflineService } from './offline.service';

/**
 * Content for offline reading. Base path: /api/v1/organisations/:organisationId/offline
 * Same rules as reading online (membership, role and subscription, checked by PermissionGuard):
 * a suspended or restricted organisation's members cannot download or refresh a copy.
 */
@Controller('organisations/:organisationId/offline')
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get('status')
  @RequireOrgPermission('constitution.read')
  @Header('Cache-Control', 'no-store')
  status(@Tenant() tenant: TenantScope, @Req() request: AppRequest) {
    return this.offline.status(tenant, request.subscriptionAccess);
  }

  @Get('bundle')
  @RequireOrgPermission('constitution.read')
  @Header('Cache-Control', 'no-store')
  bundle(@Tenant() tenant: TenantScope, @Req() request: AppRequest) {
    return this.offline.bundle(tenant, request.subscriptionAccess);
  }
}
