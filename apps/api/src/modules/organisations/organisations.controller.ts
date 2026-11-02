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
import { CurrentAuth, CurrentMembership, RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { AuditService } from '../audit/audit.service';
import { InvitationsService } from './invitations.service';
import { MembershipsService } from './memberships.service';
import { OrganisationProfileService } from './organisation-profile.service';

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
const colourSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'must be a colour like #0B1F3A' });
// Unknown fields (for example an "organisationId") are discarded: the organisation always
// comes from the verified membership.
const brandingSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).nullable().optional(),
    tagline: z.string().trim().max(300).nullable().optional(),
    primaryColour: colourSchema.optional(),
    accentColour: colourSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Provide at least one field.' });

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
  createInvitation(
    @CurrentAuth() auth: AuthContext,
    @CurrentMembership() membership: MembershipContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { email, role } = parseInput(inviteSchema, body);
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
  updateBranding(@Tenant() tenant: TenantScope, @Body() body: unknown, @Req() request: AppRequest) {
    const change = parseInput(brandingSchema, body);
    return this.profile.updateBranding(tenant, change, requestMeta(request));
  }

  @Get('subscription')
  @RequireOrgPermission('billing.read')
  getSubscription(@Tenant() tenant: TenantScope) {
    return this.profile.getSubscription(tenant);
  }

  @Get('usage')
  @RequireOrgPermission('billing.read')
  getUsage(@Tenant() tenant: TenantScope) {
    return this.profile.usageSummary(tenant);
  }
}
