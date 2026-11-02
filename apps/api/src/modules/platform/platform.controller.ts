import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { USER_STATUSES } from '@constitution/db';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest, type AuthContext } from '../../common/request-context';
import { emailSchema, parseInput } from '../../common/validation';
import { CurrentAuth, RequireSuperAdmin } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from '../organisations/invitations.service';
import { PlatformService } from './platform.service';

const createOrganisationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
      error: 'must be 3-50 lower-case letters, numbers or hyphens',
    }),
});
const ownerInvitationSchema = z.object({ email: emailSchema });
const userStatusSchema = z.object({ status: z.enum(USER_STATUSES) });
const limitSchema = z.coerce.number().int().min(1).max(500).default(100);

/**
 * Platform Super Admin operations. Base path: /api/v1/platform
 * Organisation management is expanded in a later stage.
 */
@Controller('platform')
@RequireSuperAdmin()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
  ) {}

  @Post('organisations')
  @HttpCode(HttpStatus.CREATED)
  createOrganisation(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { name, slug } = parseInput(createOrganisationSchema, body);
    return this.platform.createOrganisation(name, slug, auth.userId, requestMeta(request));
  }

  @Get('organisations')
  listOrganisations() {
    return this.platform.listOrganisations();
  }

  /** Invites the first (or an additional) Organisation Owner. */
  @Post('organisations/:organisationId/owner-invitations')
  @HttpCode(HttpStatus.CREATED)
  inviteOwner(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { email } = parseInput(ownerInvitationSchema, body);
    return this.invitations.create(
      parseId(organisationId, 'Organisation'),
      { kind: 'platform', userId: auth.userId },
      email,
      'owner',
      requestMeta(request),
    );
  }

  @Patch('users/:userId/status')
  setUserStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { status } = parseInput(userStatusSchema, body);
    return this.platform.setUserStatus(
      parseId(userId, 'User'),
      status,
      auth.userId,
      requestMeta(request),
    );
  }

  @Get('audit-events')
  listAuditEvents(@Query('limit') limit?: string) {
    const parsed = limitSchema.safeParse(limit);
    if (!parsed.success) {
      throw new BadRequestException('limit must be a whole number between 1 and 500.');
    }
    return this.audit.listAll(parsed.data);
  }
}
