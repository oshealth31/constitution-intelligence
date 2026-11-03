import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from '../../common/request-context';
import {
  AllowInactiveSubscription,
  Public,
  RequireOrgPermission,
  Tenant,
} from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { PortalService } from './portal.service';

/**
 * Public portal information, used by the branded sign-in page.
 * Base path: /api/v1/portal/:slug
 */
@Controller('portal/:slug')
export class PublicPortalController {
  constructor(private readonly portal: PortalService) {}

  @Public()
  @Get()
  branding(@Param('slug') slug: string) {
    return this.portal.publicPortal(slug);
  }

  @Public()
  @Get('logo')
  async logo(@Param('slug') slug: string, @Res() response: Response): Promise<void> {
    const { content, contentType } = await this.portal.publicLogo(slug);
    response
      .status(200)
      .set({
        'Content-Type': contentType,
        'Content-Length': String(content.length),
        'Content-Disposition': 'inline; filename="logo"',
        // The address includes the logo's ID (?v=...), so a new logo is always a new address.
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        // Even if a browser opened the image directly, nothing in it may run.
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(content);
  }
}

/** The signed-in portal home. Base path: /api/v1/organisations/:organisationId/portal */
@Controller('organisations/:organisationId/portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /**
   * Works even when the subscription is inactive, so members are told why the portal is not
   * available instead of seeing errors. Everything else refuses them (PermissionGuard).
   */
  @Get()
  @RequireOrgPermission('organisation.read')
  @AllowInactiveSubscription()
  async home(@Tenant() tenant: TenantScope, @Req() request: AppRequest) {
    const access = request.subscriptionAccess;
    return {
      ...(await this.portal.home(tenant)),
      subscription: access
        ? {
            state: access.state,
            message: access.message,
            fullAccess: access.fullAccess,
            readOnly: access.readOnly,
            features: access.features,
          }
        : null,
    };
  }
}
