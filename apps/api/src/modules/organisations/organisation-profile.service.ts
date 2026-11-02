import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  files,
  organisationBranding,
  organisations,
  subscriptions,
  usageRecords,
  type Database,
} from '@constitution/db';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { StorageService, tenantPrefix } from '../files/storage.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { detectImageType, LOGO_MAX_BYTES, type BrandingChange } from './branding-input';

export type { BrandingChange } from './branding-input';

const LOGO_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

/** Organisation profile: branding, subscription and usage. Everything runs under RLS. */
@Injectable()
export class OrganisationProfileService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  getBranding(scope: TenantScope) {
    return this.tenantDb.run(scope, async (tx) => {
      const [row] = await tx
        .select({
          organisationName: organisations.name,
          slug: organisations.slug,
          displayName: organisationBranding.displayName,
          tagline: organisationBranding.tagline,
          welcomeMessage: organisationBranding.welcomeMessage,
          primaryColour: organisationBranding.primaryColour,
          secondaryColour: organisationBranding.secondaryColour,
          accentColour: organisationBranding.accentColour,
          logoFileId: organisationBranding.logoFileId,
          updatedAt: organisationBranding.updatedAt,
        })
        .from(organisations)
        .leftJoin(organisationBranding, eq(organisationBranding.organisationId, organisations.id))
        .where(eq(organisations.id, scope.organisationId))
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Replaces the organisation's logo. The bytes must really be a PNG, JPEG or WebP image
   * (checked from the content itself); anything else, including SVG, is refused and recorded.
   */
  async setLogo(scope: TenantScope, fileName: string, content: Buffer, meta: RequestMeta) {
    const contentType = detectImageType(content);
    if (content.length > LOGO_MAX_BYTES || !contentType) {
      await this.audit.record({
        action: 'organisation.logo_rejected',
        outcome: 'failure',
        actorUserId: scope.userId,
        organisationId: scope.organisationId,
        targetType: 'organisation',
        targetId: scope.organisationId,
        metadata: {
          reason: contentType ? 'too_large' : 'not_an_allowed_image',
          size: content.length,
        },
        meta,
      });
      throw new BadRequestException(
        contentType
          ? 'The logo must be 512 KB or smaller.'
          : 'The logo must be a PNG, JPEG or WebP image. Other files, including SVG, are not accepted.',
      );
    }
    const id = randomUUID();
    const storageKey = `${tenantPrefix(scope.organisationId)}branding/logo-${id}.${LOGO_EXTENSIONS[contentType]}`;
    await this.storage.put(scope, storageKey, content);
    await this.tenantDb.run(scope, async (tx) => {
      await tx.insert(files).values({
        id,
        organisationId: scope.organisationId,
        storageKey,
        originalFilename: fileName,
        contentType,
        sizeBytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        uploadedByUserId: scope.userId,
        purpose: 'branding_logo',
      });
      await tx
        .insert(organisationBranding)
        .values({ organisationId: scope.organisationId, logoFileId: id })
        .onConflictDoUpdate({
          target: organisationBranding.organisationId,
          set: { logoFileId: id, updatedAt: new Date() },
        });
    });
    await this.audit.record({
      action: 'organisation.logo_updated',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'organisation',
      targetId: scope.organisationId,
      metadata: { contentType, size: content.length },
      meta,
    });
    return this.getBranding(scope);
  }

  async removeLogo(scope: TenantScope, meta: RequestMeta) {
    await this.tenantDb.run(scope, (tx) =>
      tx
        .update(organisationBranding)
        .set({ logoFileId: null, updatedAt: new Date() })
        .where(eq(organisationBranding.organisationId, scope.organisationId)),
    );
    await this.audit.record({
      action: 'organisation.logo_removed',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'organisation',
      targetId: scope.organisationId,
      meta,
    });
    return this.getBranding(scope);
  }

  /** Changes the portal address. Only the organisation's own row is touched. */
  async changeSlug(scope: TenantScope, slug: string, meta: RequestMeta) {
    const [current] = await this.db
      .select({ slug: organisations.slug })
      .from(organisations)
      .where(eq(organisations.id, scope.organisationId))
      .limit(1);
    if (current?.slug === slug) {
      return { slug };
    }
    const [taken] = await this.db
      .select({ id: organisations.id })
      .from(organisations)
      .where(and(eq(organisations.slug, slug), ne(organisations.id, scope.organisationId)))
      .limit(1);
    if (taken) {
      throw new ConflictException('That portal address is already in use. Please choose another.');
    }
    try {
      await this.db
        .update(organisations)
        .set({ slug, updatedAt: new Date() })
        .where(eq(organisations.id, scope.organisationId));
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string }).cause?.code;
      if (code === '23505') {
        throw new ConflictException(
          'That portal address is already in use. Please choose another.',
        );
      }
      throw error;
    }
    await this.audit.record({
      action: 'organisation.slug_changed',
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'organisation',
      targetId: scope.organisationId,
      metadata: { from: current?.slug, to: slug },
      meta,
    });
    return { slug };
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
