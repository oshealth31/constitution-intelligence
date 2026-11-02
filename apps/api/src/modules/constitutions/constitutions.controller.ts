import { Controller, Get, Param } from '@nestjs/common';
import { parseId } from '../../common/ids';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { ConstitutionsService } from './constitutions.service';

/** Read access to constitutions. Base path: /api/v1/organisations/:organisationId */
@Controller('organisations/:organisationId')
export class ConstitutionsController {
  constructor(private readonly constitutionsService: ConstitutionsService) {}

  @Get('constitutions')
  @RequireOrgPermission('constitution.read')
  list(@Tenant() tenant: TenantScope) {
    return this.constitutionsService.listConstitutions(tenant);
  }

  /** The constitution library shown in the organisation portal. */
  @Get('library')
  @RequireOrgPermission('constitution.read')
  library(@Tenant() tenant: TenantScope) {
    return this.constitutionsService.library(tenant);
  }

  @Get('constitutions/:constitutionId')
  @RequireOrgPermission('constitution.read')
  constitution(@Tenant() tenant: TenantScope, @Param('constitutionId') constitutionId: string) {
    return this.constitutionsService.getConstitution(tenant, parseId(constitutionId, 'Constitution'));
  }

  /** Approval status of every version. Reviewers, administrators and owners. */
  @Get('content-status')
  @RequireOrgPermission('content.review')
  contentStatus(@Tenant() tenant: TenantScope) {
    return this.constitutionsService.contentStatus(tenant);
  }

  @Get('constitutions/:constitutionId/versions')
  @RequireOrgPermission('constitution.read')
  versions(@Tenant() tenant: TenantScope, @Param('constitutionId') constitutionId: string) {
    return this.constitutionsService.listVersions(tenant, parseId(constitutionId, 'Constitution'));
  }

  @Get('versions/:versionId/sections')
  @RequireOrgPermission('constitution.read')
  sections(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string) {
    return this.constitutionsService.listSections(tenant, parseId(versionId, 'Version'));
  }

  @Get('versions/:versionId/extracted-text')
  @RequireOrgPermission('content.review')
  extractedText(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string) {
    return this.constitutionsService.getExtractedText(tenant, parseId(versionId, 'Version'));
  }

  @Get('versions/:versionId/approvals')
  @RequireOrgPermission('content.review')
  approvals(@Tenant() tenant: TenantScope, @Param('versionId') versionId: string) {
    return this.constitutionsService.listApprovals(tenant, parseId(versionId, 'Version'));
  }
}
