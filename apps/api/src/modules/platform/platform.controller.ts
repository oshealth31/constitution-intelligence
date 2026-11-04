import {
  BadRequestException,
  Body,
  NotFoundException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ORGANISATION_STATUSES, USER_STATUSES } from '@constitution/db';
import { BILLING_INTERVALS } from '@constitution/shared';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest, type AuthContext } from '../../common/request-context';
import { displayNameSchema, emailSchema, parseInput, uuidSchema } from '../../common/validation';
import { CurrentAuth, RequireSuperAdmin } from '../access/decorators';
import { brandingChangeSchema, slugSchema } from '../organisations/branding-input';
import { InvitationsService } from '../organisations/invitations.service';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformService } from './platform.service';
import { PlatformBillingService } from '../subscriptions/platform-billing.service';
import { TwoStepService } from '../auth/two-step.service';
import { OrganisationDeletionService } from './organisation-deletion.service';
import { FileQuarantineService } from './file-quarantine.service';
import { DataRequestsService } from './data-requests.service';

const nameSchema = z.string().trim().min(2).max(200);
const createOrganisationSchema = z.object({ name: nameSchema, slug: slugSchema });
const updateOrganisationSchema = z
  .object({ name: nameSchema.optional(), slug: slugSchema.optional() })
  .refine((value) => value.name !== undefined || value.slug !== undefined, {
    error: 'Provide a name or a slug to change.',
  });
const reasonSchema = z
  .string({ error: 'is required' })
  .trim()
  .min(10, { error: 'must explain why, in at least 10 characters' })
  .max(500);
const statusChangeSchema = z.object({
  status: z.enum(ORGANISATION_STATUSES),
  reason: reasonSchema,
});
const subscriptionSchema = z.object({
  planCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/, { error: 'must be 2-40 lower-case letters, numbers, - or _' }),
  // Suspension and cancellation have their own steps (with a reason): see PlatformBillingController.
  status: z.enum(['trialing', 'active'], {
    error: 'must be "trialing" (pilot) or "active"; use suspend or cancel for those changes',
  }),
  billingInterval: z.enum(BILLING_INTERVALS).optional(),
  autoRenew: z.boolean().optional(),
  currentPeriodStart: z.iso
    .datetime({ offset: true, error: 'must be a date and time' })
    .nullable()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
  currentPeriodEnd: z.iso
    .datetime({ offset: true, error: 'must be a date and time' })
    .nullable()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
});
const ownerInvitationSchema = z.object({ email: emailSchema });
const administratorInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(['owner', 'admin']),
});
const administratorStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });
const supportAccessSchema = z.object({ reason: reasonSchema });
const userStatusSchema = z.object({ status: z.enum(USER_STATUSES) });
const deletionRequestSchema = z.object({
  confirmSlug: z.string().trim().max(60),
  reason: reasonSchema,
  exportConfirmed: z.literal(true, {
    error: 'must be ticked: the data was exported, or the owner declined an export',
  }),
});
const deletionApprovalSchema = z.object({ confirmSlug: z.string().trim().max(60) });
const isoDate = z.iso.date({ error: 'must be a date (YYYY-MM-DD)' });
const dataRequestSchema = z.object({
  kind: z.enum(['copy', 'correction', 'deletion']),
  email: emailSchema,
  receivedOn: isoDate,
  respondBy: isoDate,
  receivedVia: z.string().trim().min(3).max(200),
  identityCheck: z
    .string()
    .trim()
    .min(10, { error: 'must say how you confirmed who is asking, in at least 10 characters' })
    .max(500),
  details: z.string().trim().max(2000).optional(),
});
const correctionSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    email: emailSchema.optional(),
    reason: reasonSchema,
  })
  .refine((value) => value.displayName !== undefined || value.email !== undefined, {
    error: 'Give a new name or a new email address.',
  });
const deletePersonSchema = z.object({ confirmEmail: z.string().max(320), reason: reasonSchema });
const noteSchema = z.object({ note: z.string().trim().min(3).max(1000) });
const dataRequestStatusSchema = z.object({
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
});
const twoStepResetSchema = z.object({ email: emailSchema, reason: reasonSchema });
const organisationQuerySchema = z.object({
  status: z.enum(ORGANISATION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});
const auditQuerySchema = z.object({
  organisationId: uuidSchema.optional(),
  action: z
    .string()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * The Platform Super Admin control centre. Base path: /api/v1/platform
 * Every route requires a signed-in Platform Super Admin (checked on the server by PermissionGuard);
 * every change is written to the audit log.
 */
@Controller('platform')
@RequireSuperAdmin()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly dashboard: PlatformDashboardService,
    private readonly invitations: InvitationsService,
    private readonly billing: PlatformBillingService,
    private readonly twoStep: TwoStepService,
    private readonly deletion: OrganisationDeletionService,
    private readonly quarantine: FileQuarantineService,
    private readonly dataRequests: DataRequestsService,
  ) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }

  @Get('organisations')
  listOrganisations(@Query() query: unknown) {
    const filter = parseInput(organisationQuerySchema, query);
    return this.dashboard.listOrganisations({
      status: filter.status,
      search: filter.search || undefined,
    });
  }

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

  @Get('organisations/:organisationId')
  getOrganisation(@Param('organisationId') organisationId: string) {
    return this.dashboard.getOrganisation(parseId(organisationId, 'Organisation'));
  }

  @Patch('organisations/:organisationId')
  updateOrganisation(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const change = parseInput(updateOrganisationSchema, body);
    return this.dashboard.updateOrganisation(
      parseId(organisationId, 'Organisation'),
      change,
      auth.userId,
      requestMeta(request),
    );
  }

  /** Activate, suspend or archive. Suspension immediately blocks the organisation's members. */
  @Post('organisations/:organisationId/status')
  @HttpCode(HttpStatus.OK)
  setOrganisationStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { status, reason } = parseInput(statusChangeSchema, body);
    return this.dashboard.setOrganisationStatus(
      parseId(organisationId, 'Organisation'),
      status,
      reason,
      auth.userId,
      requestMeta(request),
    );
  }

  @Patch('organisations/:organisationId/branding')
  updateBranding(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const change = parseInput(brandingChangeSchema, body);
    return this.dashboard.updateBranding(
      parseId(organisationId, 'Organisation'),
      change,
      auth.userId,
      requestMeta(request),
    );
  }

  /** Manual subscription management. No payment provider is connected yet. */
  @Put('organisations/:organisationId/subscription')
  async setSubscription(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const change = parseInput(subscriptionSchema, body);
    const id = parseId(organisationId, 'Organisation');
    await this.billing.updateSubscription(
      id,
      {
        planCode: change.planCode,
        status: change.status,
        billingInterval: change.billingInterval,
        autoRenew: change.autoRenew,
        currentPeriodStart: change.currentPeriodStart,
        currentPeriodEnd: change.currentPeriodEnd ?? null,
      },
      auth.userId,
      requestMeta(request),
    );
    return this.dashboard.getOrganisation(id);
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

  /** Invites an Owner or Administrator. */
  @Post('organisations/:organisationId/administrator-invitations')
  @HttpCode(HttpStatus.CREATED)
  inviteAdministrator(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { email, role } = parseInput(administratorInvitationSchema, body);
    return this.invitations.create(
      parseId(organisationId, 'Organisation'),
      { kind: 'platform', userId: auth.userId },
      email,
      role,
      requestMeta(request),
    );
  }

  @Post('organisations/:organisationId/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: AppRequest,
  ): Promise<void> {
    await this.invitations.revoke(
      parseId(organisationId, 'Organisation'),
      parseId(invitationId, 'Invitation'),
      auth.userId,
      requestMeta(request),
    );
  }

  @Patch('organisations/:organisationId/administrators/:membershipId')
  setAdministratorStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { status } = parseInput(administratorStatusSchema, body);
    return this.dashboard.setAdministratorStatus(
      parseId(organisationId, 'Organisation'),
      parseId(membershipId, 'Administrator'),
      status,
      auth.userId,
      requestMeta(request),
    );
  }

  /**
   * Restricted access to an organisation's published constitution text for support purposes.
   * A reason is required; the access is recorded in the platform AND the organisation's audit log.
   */
  @Post('organisations/:organisationId/support-access')
  @HttpCode(HttpStatus.OK)
  supportAccess(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { reason } = parseInput(supportAccessSchema, body);
    return this.dashboard.supportContentAccess(
      parseId(organisationId, 'Organisation'),
      reason,
      auth.userId,
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

  /** The organisation's uploaded files, with downloads and quarantine status (staff tool). */
  @Get('organisations/:organisationId/files')
  listFiles(@Param('organisationId') organisationId: string) {
    return this.quarantine.list(parseId(organisationId, 'Organisation'));
  }

  /** Who downloaded a file (from the audit log). */
  @Get('organisations/:organisationId/files/:fileId/downloads')
  fileDownloads(@Param('organisationId') organisationId: string, @Param('fileId') fileId: string) {
    return this.quarantine.downloads(
      parseId(organisationId, 'Organisation'),
      parseId(fileId, 'File'),
    );
  }

  /** quarantine | release | remove, each with a reason. */
  @Post('organisations/:organisationId/files/:fileId/:action')
  @HttpCode(HttpStatus.OK)
  changeFile(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Param('fileId') fileId: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { reason } = parseInput(z.object({ reason: reasonSchema }), body);
    const args = [
      parseId(organisationId, 'Organisation'),
      parseId(fileId, 'File'),
      reason,
      auth.userId,
      requestMeta(request),
    ] as const;
    switch (action) {
      case 'quarantine':
        return this.quarantine.quarantine(...args);
      case 'release':
        return this.quarantine.release(...args);
      case 'remove':
        return this.quarantine.remove(...args);
      default:
        throw new NotFoundException('Unknown action.');
    }
  }

  // ----- Personal data requests (Task D11) -----

  @Get('data-requests')
  listDataRequests(@Query() query: unknown) {
    return this.dataRequests.list(parseInput(dataRequestStatusSchema, query).status);
  }

  @Post('data-requests')
  createDataRequest(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    return this.dataRequests.create(
      parseInput(dataRequestSchema, body),
      auth.userId,
      requestMeta(request),
    );
  }

  @Get('data-requests/:requestId')
  getDataRequest(@Param('requestId') requestId: string) {
    return this.dataRequests.get(parseId(requestId, 'Request'));
  }

  /** The copy of the person's data, as a JSON file to send to them. Audited. */
  @Get('data-requests/:requestId/copy')
  async dataRequestCopy(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') requestId: string,
    @Req() request: AppRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { fileName, content } = await this.dataRequests.copy(
      parseId(requestId, 'Request'),
      auth.userId,
      requestMeta(request),
    );
    response
      .status(200)
      .set({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }

  @Post('data-requests/:requestId/correct')
  @HttpCode(HttpStatus.OK)
  correctPerson(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { reason, ...change } = parseInput(correctionSchema, body);
    return this.dataRequests.correct(
      parseId(requestId, 'Request'),
      { ...change, reason },
      auth.userId,
      requestMeta(request),
    );
  }

  @Post('data-requests/:requestId/delete-person')
  @HttpCode(HttpStatus.OK)
  deletePerson(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { confirmEmail, reason } = parseInput(deletePersonSchema, body);
    return this.dataRequests.deletePerson(
      parseId(requestId, 'Request'),
      confirmEmail,
      reason,
      auth.userId,
      requestMeta(request),
    );
  }

  @Post('data-requests/:requestId/complete')
  @HttpCode(HttpStatus.OK)
  completeDataRequest(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { note } = parseInput(noteSchema, body);
    return this.dataRequests.complete(
      parseId(requestId, 'Request'),
      note,
      auth.userId,
      requestMeta(request),
    );
  }

  @Post('data-requests/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDataRequest(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { reason } = parseInput(z.object({ reason: reasonSchema }), body);
    return this.dataRequests.cancel(
      parseId(requestId, 'Request'),
      reason,
      auth.userId,
      requestMeta(request),
    );
  }

  /** What deleting this organisation would remove and keep, and any waiting request. */
  @Get('organisations/:organisationId/deletion')
  deletionPreview(@Param('organisationId') organisationId: string) {
    return this.deletion.preview(parseId(organisationId, 'Organisation'));
  }

  /** Step 1: ask for the organisation's data to be deleted (see the approval rules in the service). */
  @Post('organisations/:organisationId/deletion-requests')
  requestDeletion(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const input = parseInput(deletionRequestSchema, body);
    return this.deletion.request(
      parseId(organisationId, 'Organisation'),
      input,
      auth.userId,
      requestMeta(request),
    );
  }

  /** Step 2: approve and delete. A different Super Admin, or the same one after 24 hours if alone. */
  @Post('organisations/:organisationId/deletion-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveDeletion(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { confirmSlug } = parseInput(deletionApprovalSchema, body);
    return this.deletion.approve(
      parseId(organisationId, 'Organisation'),
      parseId(requestId, 'Deletion request'),
      confirmSlug,
      auth.userId,
      requestMeta(request),
    );
  }

  @Post('organisations/:organisationId/deletion-requests/:requestId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDeletion(
    @CurrentAuth() auth: AuthContext,
    @Param('organisationId') organisationId: string,
    @Param('requestId') requestId: string,
    @Req() request: AppRequest,
  ) {
    return this.deletion.cancel(
      parseId(organisationId, 'Organisation'),
      parseId(requestId, 'Deletion request'),
      auth.userId,
      requestMeta(request),
    );
  }

  /** Tries again to remove a deleted organisation's files from storage. */
  @Post('organisations/:organisationId/deletion/remove-files')
  @HttpCode(HttpStatus.OK)
  async removeDeletedFiles(@Param('organisationId') organisationId: string) {
    const id = parseId(organisationId, 'Organisation');
    return { filesRemoved: await this.deletion.removeFiles(id) };
  }

  /**
   * Removes someone's two-step sign-in (lost phone, no recovery codes) and signs them out
   * everywhere. Needs a reason; audited; the person is told by email. Not for your own account.
   */
  @Post('two-step/reset')
  @HttpCode(HttpStatus.OK)
  resetTwoStep(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    const { email, reason } = parseInput(twoStepResetSchema, body);
    return this.twoStep.reset(email, auth.userId, reason, requestMeta(request));
  }

  @Get('audit-events')
  listAuditEvents(@Query() query: unknown) {
    const filter = parseInput(auditQuerySchema, query);
    if (filter.before && Number.isNaN(Date.parse(filter.before))) {
      throw new BadRequestException('before must be a date and time.');
    }
    return this.dashboard.auditEvents({
      organisationId: filter.organisationId,
      actionPrefix: filter.action,
      outcome: filter.outcome,
      before: filter.before ? new Date(filter.before) : undefined,
      limit: filter.limit,
    });
  }

  @Get('support')
  support() {
    return this.dashboard.support();
  }

  @Get('health')
  health() {
    return this.dashboard.health();
  }
}
