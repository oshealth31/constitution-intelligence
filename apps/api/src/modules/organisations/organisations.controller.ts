import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { MEMBERSHIP_STATUSES, organisations, type Database } from '@constitution/db';
import { ORGANISATION_ROLES } from '@constitution/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import {
  requestMeta,
  type AppRequest,
  type AuthContext,
  type MembershipContext,
} from '../../common/request-context';
import { emailSchema, parseInput } from '../../common/validation';
import { DRIZZLE } from '../../database/database.constants';
import {
  AllowInactiveSubscription,
  CurrentAuth,
  CurrentMembership,
  RequireFeature,
  RequireOrgPermission,
  Tenant,
} from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from './invitations.service';
import { MembershipsService } from './memberships.service';
import { brandingChangeSchema, logoUploadSchema, slugSchema } from './branding-input';
import { OrganisationProfileService } from './organisation-profile.service';
import { LimitsService } from '../subscriptions/limits.service';

const inviteSchema = z.object({ email: emailSchema, role: z.enum(ORGANISATION_ROLES) });
const updateMemberSchema = z
  .object({
    role: z.enum(ORGANISATION_ROLES).optional(),
    status: z.enum(MEMBERSHIP_STATUSES).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    error: 'Provide a role or a status to change.',
  });
const limitSchema = z.coerce.number().int().min(1).max(500).default(100);
const settingsSchema = z.object({ slug: slugSchema });

/**
 * Organisation-level access management. Every route requires membership of the organisation
 * in the URL and a role with the named permission (checked by PermissionGuard on the server).
 * Base path: /api/v1/organisations/:organisationId
 */
@Controller('organisations/:organisationId')
export class OrganisationsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly memberships: MembershipsService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
    private readonly profile: OrganisationProfileService,
    private readonly limits: LimitsService,
  ) {}

  @Get()
  @RequireOrgPermission('organisation.read')
  async getOrganisation(@CurrentMembership() membership: MembershipContext) {
    const [organisation] = await this.db
      .select({
        id: organisations.id,
        slug: organisations.slug,
        name: organisations.name,
        status: organisations.status,
      })
      .from(organisations)
      .where(eq(organisations.id, membership.organisationId))
      .limit(1);
    return { organisation, yourRole: membership.role };
  }

  @Get('members')
  @RequireOrgPermission('members.read')
  listMembers(@Tenant() tenant: TenantScope) {
    return this.memberships.list(tenant);
  }

  @Patch('members/:membershipId')
  @RequireOrgPermission('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateMember(
    @CurrentAuth() auth: AuthContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ): Promise<void> {
    const change = parseInput(updateMemberSchema, body);
    await this.memberships.update(
      { ...membership, userId: auth.userId },
      parseId(membershipId, 'Member'),
      change,
      requestMeta(request),
    );
  }

  @Delete('members/:membershipId')
  @RequireOrgPermission('members.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentAuth() auth: AuthContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('membershipId') membershipId: string,
    @Req() request: AppRequest,
  ): Promise<void> {
    await this.memberships.remove(
      { ...membership, userId: auth.userId },
      parseId(membershipId, 'Member'),
      requestMeta(request),
    );
  }

  @Get('invitations')
  @RequireOrgPermission('members.read')
  listInvitations(@Tenant() tenant: TenantScope) {
    return this.invitations.list(tenant);
  }

  @Post('invitations')
  @RequireOrgPermission('members.invite')
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @CurrentAuth() auth: AuthContext,
    @CurrentMembership() membership: MembershipContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { email, role } = parseInput(inviteSchema, body);
    await this.limits.assertWithinLimit(membership.tenant, 'members');
    return this.invitations.create(
      membership.organisationId,
      { kind: 'member', userId: auth.userId, role: membership.role },
      email,
      role,
      requestMeta(request),
    );
  }

  @Post('invitations/:invitationId/revoke')
  @RequireOrgPermission('members.invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @CurrentAuth() auth: AuthContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('invitationId') invitationId: string,
    @Req() request: AppRequest,
  ): Promise<void> {
    await this.invitations.revoke(
      membership.organisationId,
      parseId(invitationId, 'Invitation'),
      auth.userId,
      requestMeta(request),
    );
  }

  @Get('audit-events')
  @RequireOrgPermission('audit.read')
  listAuditEvents(@Tenant() tenant: TenantScope, @Query('limit') limit?: string) {
    const parsed = limitSchema.safeParse(limit);
    if (!parsed.success) {
      throw new BadRequestException('limit must be a whole number between 1 and 500.');
    }
    return this.audit.listForOrganisation(tenant, parsed.data);
  }

  @Get('branding')
  @RequireOrgPermission('organisation.read')
  getBranding(@Tenant() tenant: TenantScope) {
    return this.profile.getBranding(tenant);
  }

  @Patch('branding')
  @RequireOrgPermission('branding.manage')
  @RequireFeature('custom_branding')
  updateBranding(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const change = parseInput(brandingChangeSchema, body);
    return this.profile.updateBranding(tenant, change, requestMeta(request));
  }

  /** Body: { fileName, dataBase64 }. The image type is worked out from the bytes themselves. */
  @Put('branding/logo')
  @RequireOrgPermission('branding.manage')
  @RequireFeature('custom_branding')
  uploadLogo(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const { fileName, dataBase64 } = parseInput(logoUploadSchema, body);
    return this.profile.setLogo(
      tenant,
      fileName,
      Buffer.from(dataBase64, 'base64'),
      requestMeta(request),
    );
  }

  @Delete('branding/logo')
  @RequireOrgPermission('branding.manage')
  removeLogo(@Tenant() tenant: TenantScope, @Req() request: AppRequest) {
    return this.profile.removeLogo(tenant, requestMeta(request));
  }

  /** Portal address (slug). Owners only: changing it changes the link every member uses. */
  @Patch('settings')
  @RequireOrgPermission('organisation.settings.manage')
  updateSettings(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const { slug } = parseInput(settingsSchema, body);
    return this.profile.changeSlug(tenant, slug, requestMeta(request));
  }

  @Get('subscription')
  @RequireOrgPermission('billing.read')
  @AllowInactiveSubscription()
  getSubscription(@Tenant() tenant: TenantScope) {
    return this.profile.getSubscription(tenant);
  }

  @Get('usage')
  @RequireOrgPermission('billing.read')
  @AllowInactiveSubscription()
  getUsage(@Tenant() tenant: TenantScope) {
    return this.profile.usageSummary(tenant);
  }
}
