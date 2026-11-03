import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { PAYMENT_METHODS } from '@constitution/shared';
import { z } from 'zod';
import { parseId } from '../../common/ids';
import { requestMeta, type AppRequest } from '../../common/request-context';
import { parseInput } from '../../common/validation';
import { AllowInactiveSubscription, RequireOrgPermission, Tenant } from '../access/decorators';
import type { TenantScope } from '../tenancy/tenant-scope';
import { BillingService } from './billing.service';

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001F\u007F]/;
export const paymentReportSchema = z.object({
  amountMinor: z.number().int().min(1).max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .min(2, { error: 'Enter the payment reference' })
    .max(100)
    .refine((value) => !CONTROL.test(value), { error: 'must be plain text' }),
  paidOn: z.iso.date({ error: 'must be a date (YYYY-MM-DD)' }),
  notes: z
    .string()
    .trim()
    .max(500)
    .refine((value) => !CONTROL.test(value.replace(/\n/g, ' ')), { error: 'must be plain text' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

/**
 * An organisation's subscription and billing. Base path: /api/v1/organisations/:id/billing
 * Available even when the subscription is inactive, so owners can see what is due and pay.
 */
@Controller('organisations/:organisationId/billing')
@AllowInactiveSubscription()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequireOrgPermission('billing.read')
  overview(@Tenant() tenant: TenantScope) {
    return this.billing.overview(tenant);
  }

  /** Owners report a payment they made. It is checked by hand before it counts. */
  @Post('invoices/:invoiceId/payments')
  @RequireOrgPermission('billing.manage')
  reportPayment(
    @Tenant() tenant: TenantScope,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
    @Req() request: AppRequest,
  ) {
    return this.billing.reportPayment(
      tenant,
      parseId(invoiceId, 'Invoice'),
      parseInput(paymentReportSchema, body),
      requestMeta(request),
    );
  }
}
