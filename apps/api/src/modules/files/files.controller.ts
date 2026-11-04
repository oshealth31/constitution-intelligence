import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { FilesService } from './files.service';

/** Original uploaded documents. Base path: /api/v1/organisations/:organisationId/files */
@Controller('organisations/:organisationId/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  @RequireOrgPermission('content.review')
  list(@Tenant() tenant: TenantScope) {
    return this.filesService.list(tenant);
  }

  @Get(':fileId/content')
  @RequireOrgPermission('content.review')
  async download(
    @Tenant() tenant: TenantScope,
    @Param('fileId') fileId: string,
    @Req() request: AppRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { file, content } = await this.filesService.read(
      tenant,
      parseId(fileId, 'File'),
      requestMeta(request),
    );
    const safeName = file.originalFilename.replace(/[^A-Za-z0-9._ -]/g, '_');
    response
      .status(200)
      .set({
        'Content-Type': file.contentType,
        'Content-Length': String(content.length),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }
}
