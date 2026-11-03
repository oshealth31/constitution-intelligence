import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { PLAN_FEATURES } from '@constitution/shared';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest, type AuthContext } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import { CurrentAuth, RequireSuperAdmin } from '../access/decorators';
import { paymentReportSchema } from './billing.controller';
import { PlatformBillingService } from './platform-billing.service';

const reason = z
  .string({ error: 'is required' })
  .trim()
  .min(10, { error: 'must explain why, in at least 10 characters' })
  .max(500);
const optionalLimit = z.number().int().min(0).max(1_000_000).nullable();
const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
  isPilot: z.boolean().default(false),
  active: z.boolean().default(true),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('BWP'),
  monthlyPriceMinor: z.number().int().min(0).max(100_000_000).nullable().default(null),
  annualPriceMinor: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  graceDays: z.number().int().min(0).max(90).default(14),
  features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length).default([]),
  maxMembers: optionalLimit.refine((value) => value !== 0, { error: 'must be at least 1, or empty for no limit' }).default(null),
  maxConstitutions: optionalLimit.refine((value) => value !== 0, { error: 'must be at least 1, or empty for no limit' }).default(null),
  maxAiQuestionsPerMonth: optionalLimit.default(null),
  maxStorageMb: optionalLimit.refine((value) => value !== 0, { error: 'must be at least 1, or empty for no limit' }).default(null),
});
const planCreateSchema = planSchema.extend({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,40}$/, { error: 'must be 2-40 lower-case letters, numbers, - or _' }),
});
const cancelSchema = z.object({ reason, when: z.enum(['period_end', 'now']) });
const dateTime = z.iso.datetime({ offset: true, error: 'must be a date and time' }).transform((value) => new Date(value));
const invoiceSchema = z.object({
  description: z.string().trim().min(3).max(300),
  amountMinor: z.number().int().min(1).max(1_000_000_000),
  dueAt: dateTime,
  periodStart: dateTime.nullable().default(null),
  periodEnd: dateTime.nullable().default(null),
});
const verifySchema = z.object({
  // The person verifying must say they have seen the money arrive. Nothing is verified automatically.
  confirmed: z.literal(true, { error: 'Confirm that you have seen the payment arrive.' }),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
});

/**
 * Plans, subscriptions, invoices and manual payment verification for Platform Super Admins.
 * Base path: /api/v1/platform
 */
@Controller('platform')
@RequireSuperAdmin()
export class PlatformBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  createPlan(@CurrentAuth() auth: AuthContext, @Body() body: unknown, @Req() request: AppRequest) {
    const { code, ...plan } = parseInput(planCreateSchema, body);
    return this.billing.createPlan(code, plan, auth.userId, requestMeta(request));
  }

  @Patch('plans/:code')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    return this.billing.updatePlan(code, parseInput(planSchema, body), auth.userId, requestMeta(request));
  }

  @Get('billing/attention')
  attention() {
    return this.billing.attention();
  }

  @Get('organisations/:organisationId/billing')
  getBilling(@Param('organisationId') organisationId: string) {
    return this.billing.getBilling(parseId(organisationId, 'Organisation'));
  }

  @Post('organisations/:organisationId/subscription/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { reason: why } = parseInput(z.object({ reason }), body);
    await this.billing.suspend(organisationId, why, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/subscription/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { reason: why } = parseInput(z.object({ reason }), body);
    await this.billing.reactivate(organisationId, why, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/subscription/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { reason: why, when } = parseInput(cancelSchema, body);
    await this.billing.cancel(organisationId, why, when, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/subscription/renew')
  @HttpCode(HttpStatus.OK)
  async renew(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    await this.billing.renew(organisationId, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/invoices')
  @HttpCode(HttpStatus.CREATED)
  async issueInvoice(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    await this.billing.issueInvoice(organisationId, parseInput(invoiceSchema, body), auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/invoices/:invoiceId/void')
  @HttpCode(HttpStatus.OK)
  async voidInvoice(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Param('invoiceId') invoiceId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { reason: why } = parseInput(z.object({ reason }), body);
    await this.billing.voidInvoice(organisationId, parseId(invoiceId, 'Invoice'), why, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/invoices/:invoiceId/payments')
  @HttpCode(HttpStatus.CREATED)
  async recordPayment(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Param('invoiceId') invoiceId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    await this.billing.recordPayment(organisationId, parseId(invoiceId, 'Invoice'), parseInput(paymentReportSchema, body), auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/payments/:paymentId/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Param('paymentId') paymentId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { note } = parseInput(verifySchema, body);
    await this.billing.verifyPayment(organisationId, parseId(paymentId, 'Payment'), note, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }

  @Post('organisations/:organisationId/payments/:paymentId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectPayment(@CurrentAuth() auth: AuthContext, @Param('organisationId') id: string, @Param('paymentId') paymentId: string, @Body() body: unknown, @Req() request: AppRequest) {
    const organisationId = parseId(id, 'Organisation');
    const { reason: why } = parseInput(z.object({ reason }), body);
    await this.billing.rejectPayment(organisationId, parseId(paymentId, 'Payment'), why, auth.userId, requestMeta(request));
    return this.billing.getBilling(organisationId);
  }
}
