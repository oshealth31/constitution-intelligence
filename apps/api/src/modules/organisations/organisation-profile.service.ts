import { Injectable } from '@nestjs/common';
import { organisationBranding, organisations, subscriptions, usageRecords } from '@constitution/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

export interface BrandingChange {
  displayName?: string | null;
  tagline?: string | null;
  primaryColour?: string;
  accentColour?: string;
}

/** Organisation profile: branding, subscription and usage. Everything runs under RLS. */
@Injectable()
export class OrganisationProfileService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  getBranding(scope: TenantScope) {
    return this.tenantDb.run(scope, async (tx) => {
      const [row] = await tx
        .select({
          organisationName: organisations.name,
          displayName: organisationBranding.displayName,
          tagline: organisationBranding.tagline,
          primaryColour: organisationBranding.primaryColour,
          accentColour: organisationBranding.accentColour,
          logoFileId: organisationBranding.logoFileId,
        })
        .from(organisations)
        .leftJoin(organisationBranding, eq(organisationBranding.organisationId, organisations.id))
        .where(eq(organisations.id, scope.organisationId))
        .limit(1);
      return row ?? null;
    });
  }

  async updateBranding(scope: TenantScope, change: BrandingChange, meta: RequestMeta) {
    await this.tenantDb.run(scope, (tx) =>
      tx
        .insert(organisationBranding)
        .values({ organisationId: scope.organisationId, ...change })
        .onConflictDoUpdate({
          target: organisationBranding.organisationId,
          set: { ...change, updatedAt: new Date() },
        }),
    );
    await this.audit.record({
      action: 'organisation.branding_updated',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'organisation',
      targetId: scope.organisationId,
      metadata: { fields: Object.keys(change) },
      meta,
    });
    return this.getBranding(scope);
  }

  getSubscription(scope: TenantScope) {
    return this.tenantDb.run(scope, async (tx) => {
      const [row] = await tx
        .select({
          id: subscriptions.id,
          planCode: subscriptions.planCode,
          status: subscriptions.status,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(organisations)
        .innerJoin(
          subscriptions,
          and(
            eq(subscriptions.id, organisations.currentSubscriptionId),
            eq(subscriptions.organisationId, organisations.id),
          ),
        )
        .where(eq(organisations.id, scope.organisationId))
        .limit(1);
      return row ?? null;
    });
  }

  /** Usage totals per metric over the last `days` days. */
  usageSummary(scope: TenantScope, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    return this.tenantDb.run(scope, (tx) =>
      tx
        .select({
          metric: usageRecords.metric,
          total: sql<number>`sum(${usageRecords.quantity})::int`,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.organisationId, scope.organisationId),
            gte(usageRecords.occurredAt, since),
          ),
        )
        .groupBy(usageRecords.metric)
        .orderBy(usageRecords.metric),
    );
  }
}
