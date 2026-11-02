import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MIGRATIONS_FOLDER,
  memberships,
  organisationBranding,
  organisations,
  pingDatabase,
  subscriptions,
  type Database,
} from '@constitution/db';
import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DATABASE_POOL, DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../files/storage.service';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import { createTenantScope } from '../tenancy/tenant-scope';
import { maskEmail, onboardingProgress } from './onboarding';

type Row = Record<string, unknown>;
const rowsOf = <T>(result: { rows: unknown[] }) => result.rows as T[];

export interface OrganisationFilter {
  status?: string;
  search?: string;
}

export interface AuditFilter {
  organisationId?: string;
  actionPrefix?: string;
  outcome?: string;
  before?: Date;
  limit: number;
}

export interface SubscriptionChange {
  planCode: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  currentPeriodEnd: Date | null;
}

const BRANDING_DEFAULTS = { primary: '#0B1F3A', accent: '#1BA6A6' };

/** SQL computing the onboarding facts for organisation alias "o". */
const ONBOARDING_COLUMNS = sql`
  (SELECT count(*) FROM memberships m WHERE m.organisation_id = o.id AND m.role = 'owner' AND m.status = 'active')::int AS "activeOwners",
  (SELECT count(*) FROM memberships m WHERE m.organisation_id = o.id AND m.role <> 'owner')::int AS "otherMembers",
  (SELECT count(*) FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active')::int AS "activeMembers",
  (SELECT count(*) FROM invitations i WHERE i.organisation_id = o.id AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL AND i.expires_at > now())::int AS "pendingInvitations",
  (SELECT count(*) FROM constitutions c WHERE c.organisation_id = o.id)::int AS "constitutions",
  (SELECT count(*) FROM files f WHERE f.organisation_id = o.id)::int AS "files",
  (SELECT count(*) FROM constitution_versions v WHERE v.organisation_id = o.id AND v.status = 'published')::int AS "publishedVersions",
  (SELECT count(*) FROM constitution_versions v WHERE v.organisation_id = o.id
     AND v.status IN ('draft', 'in_review', 'approved'))::int AS "versionsInProgress",
  EXISTS (
    SELECT 1 FROM organisation_branding b WHERE b.organisation_id = o.id AND (
      b.tagline IS NOT NULL OR b.logo_file_id IS NOT NULL
      OR upper(b.primary_colour) <> ${BRANDING_DEFAULTS.primary}
      OR upper(b.accent_colour) <> ${BRANDING_DEFAULTS.accent})
  ) AS "brandingConfigured"`;

interface OnboardingRow {
  activeOwners: number;
  otherMembers: number;
  activeMembers: number;
  pendingInvitations: number;
  constitutions: number;
  files: number;
  publishedVersions: number;
  versionsInProgress: number;
  brandingConfigured: boolean;
  subscriptionStatus: string | null;
}

/**
 * Read models and privileged operations for the Platform Super Admin control centre.
 * Data minimisation: organisation overviews contain statuses and counts, never constitution text
 * or ordinary members' personal details. Viewing content requires a stated reason and is audited
 * (see supportContentAccess).
 */
@Injectable()
export class PlatformDashboardService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly tenantDb: TenantDatabase,
  ) {}

  async overview() {
    const [totals] = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT
          (SELECT count(*) FROM organisations)::int AS "organisationsTotal",
          (SELECT count(*) FROM organisations WHERE status = 'active')::int AS "organisationsActive",
          (SELECT count(*) FROM organisations WHERE status = 'suspended')::int AS "organisationsSuspended",
          (SELECT count(*) FROM users)::int AS "usersTotal",
          (SELECT count(*) FROM users WHERE status = 'active')::int AS "usersActive",
          (SELECT count(*) FROM memberships WHERE status = 'active')::int AS "activeMemberships",
          (SELECT count(*) FROM constitutions)::int AS "constitutions",
          (SELECT count(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL
             AND expires_at > now())::int AS "pendingInvitations",
          (SELECT count(*) FROM audit_events WHERE action = 'auth.login.failed'
             AND occurred_at > now() - interval '24 hours')::int AS "failedLogins24h",
          (SELECT count(*) FROM audit_events WHERE occurred_at > now() - interval '24 hours')::int AS "auditEvents24h"
      `),
    );
    const subscriptionsByStatus = rowsOf<{ status: string; count: number }>(
      await this.db.execute(sql`
        SELECT s.status, count(*)::int AS count
        FROM organisations o
        JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        GROUP BY s.status ORDER BY s.status`),
    );
    const versionsByStatus = rowsOf<{ status: string; count: number }>(
      await this.db.execute(sql`
        SELECT status, count(*)::int AS count FROM constitution_versions
        GROUP BY status ORDER BY status`),
    );
    const usage30d = rowsOf<{ metric: string; total: number }>(
      await this.db.execute(sql`
        SELECT metric, sum(quantity)::int AS total FROM usage_records
        WHERE occurred_at > now() - interval '30 days'
        GROUP BY metric ORDER BY metric`),
    );
    const recentOrganisations = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT id, name, slug, status, created_at AS "createdAt"
        FROM organisations ORDER BY created_at DESC LIMIT 5`),
    );
    return { totals, subscriptionsByStatus, versionsByStatus, usage30d, recentOrganisations };
  }

  async listOrganisations(filter: OrganisationFilter) {
    const conditions: SQL[] = [sql`true`];
    if (filter.status) {
      conditions.push(sql`o.status = ${filter.status}`);
    }
    if (filter.search) {
      const pattern = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(o.name ILIKE ${pattern} OR o.slug ILIKE ${pattern})`);
    }
    const rows = rowsOf<Row & OnboardingRow>(
      await this.db.execute(sql`
        SELECT o.id, o.name, o.slug, o.status, o.created_at AS "createdAt",
               s.plan_code AS "planCode", s.status AS "subscriptionStatus",
               s.current_period_end AS "currentPeriodEnd",
               ${ONBOARDING_COLUMNS}
        FROM organisations o
        LEFT JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY o.created_at DESC
        LIMIT 500`),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdAt: row.createdAt,
      subscription: row.planCode
        ? {
            planCode: row.planCode,
            status: row.subscriptionStatus,
            currentPeriodEnd: row.currentPeriodEnd,
          }
        : null,
      activeMembers: row.activeMembers,
      publishedVersions: row.publishedVersions,
      versionsInProgress: row.versionsInProgress,
      onboarding: onboardingProgress(row),
    }));
  }

  async getOrganisation(organisationId: string) {
    const [organisation] = rowsOf<Row & OnboardingRow>(
      await this.db.execute(sql`
        SELECT o.id, o.name, o.slug, o.status, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
               s.status AS "subscriptionStatus",
               ${ONBOARDING_COLUMNS}
        FROM organisations o
        LEFT JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE o.id = ${organisationId}`),
    );
    if (!organisation) {
      throw new NotFoundException('Organisation not found.');
    }

    const [branding] = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT display_name AS "displayName", tagline, primary_colour AS "primaryColour",
               accent_colour AS "accentColour", logo_file_id AS "logoFileId", updated_at AS "updatedAt"
        FROM organisation_branding WHERE organisation_id = ${organisationId}`),
    );
    const [subscription] = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT s.id, s.plan_code AS "planCode", s.status, s.current_period_start AS "currentPeriodStart",
               s.current_period_end AS "currentPeriodEnd", s.updated_at AS "updatedAt"
        FROM organisations o
        JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE o.id = ${organisationId}`),
    );
    // Only Owners and Administrators are listed by name: the platform needs them to manage the account.
    const administrators = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT m.id AS "membershipId", u.id AS "userId", u.display_name AS "displayName", u.email,
               m.role, m.status AS "membershipStatus", u.status AS "accountStatus",
               u.last_login_at AS "lastSignInAt", m.created_at AS "joinedAt"
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organisation_id = ${organisationId} AND m.role IN ('owner', 'admin')
        ORDER BY m.role DESC, u.display_name`),
    );
    const administratorInvitations = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"
        FROM invitations
        WHERE organisation_id = ${organisationId} AND role IN ('owner', 'admin')
          AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`),
    );
    const memberCounts = rowsOf<{ role: string; count: number }>(
      await this.db.execute(sql`
        SELECT role, count(*)::int AS count FROM memberships
        WHERE organisation_id = ${organisationId} AND status = 'active'
        GROUP BY role ORDER BY role`),
    );
    const versionsByStatus = rowsOf<{ status: string; count: number }>(
      await this.db.execute(sql`
        SELECT status, count(*)::int AS count FROM constitution_versions
        WHERE organisation_id = ${organisationId} GROUP BY status ORDER BY status`),
    );
    const [latestVersion] = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT v.id, v.version_number AS "versionNumber", v.label, v.status, v.updated_at AS "updatedAt",
               c.title AS "constitutionTitle",
               (SELECT count(*) FROM sections s WHERE s.version_id = v.id)::int AS "sectionCount",
               EXISTS (SELECT 1 FROM extracted_texts e WHERE e.version_id = v.id) AS "textExtracted"
        FROM constitution_versions v JOIN constitutions c ON c.id = v.constitution_id
        WHERE v.organisation_id = ${organisationId}
        ORDER BY v.updated_at DESC, v.version_number DESC LIMIT 1`),
    );
    const [storage] = rowsOf<{ files: number; bytes: number }>(
      await this.db.execute(sql`
        SELECT count(*)::int AS files, coalesce(sum(size_bytes), 0)::bigint AS bytes
        FROM files WHERE organisation_id = ${organisationId}`),
    );
    const usage30d = rowsOf<{ metric: string; total: number }>(
      await this.db.execute(sql`
        SELECT metric, sum(quantity)::int AS total FROM usage_records
        WHERE organisation_id = ${organisationId} AND occurred_at > now() - interval '30 days'
        GROUP BY metric ORDER BY metric`),
    );

    return {
      organisation: {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        status: organisation.status,
        createdAt: organisation.createdAt,
        updatedAt: organisation.updatedAt,
      },
      branding: branding ?? null,
      subscription: subscription ?? null,
      administrators,
      administratorInvitations,
      memberCounts,
      onboarding: onboardingProgress(organisation),
      processing: {
        versionsByStatus,
        latestVersion: latestVersion ?? null,
        files: storage?.files ?? 0,
        storageBytes: Number(storage?.bytes ?? 0),
      },
      usage30d,
    };
  }

  async updateOrganisation(
    organisationId: string,
    change: { name?: string; slug?: string },
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const [before] = await this.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!before) {
      throw new NotFoundException('Organisation not found.');
    }
    if (change.slug && change.slug !== before.slug) {
      const [taken] = await this.db
        .select({ id: organisations.id })
        .from(organisations)
        .where(and(eq(organisations.slug, change.slug), ne(organisations.id, organisationId)))
        .limit(1);
      if (taken) {
        throw new ConflictException('An organisation with this web address (slug) already exists.');
      }
    }
    await this.db
      .update(organisations)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(organisations.id, organisationId));
    await this.audit.record({
      action: 'organisation.updated',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: {
        by: 'platform',
        changes: Object.fromEntries(
          Object.entries(change).map(([key, value]) => [
            key,
            { from: before[key as 'name' | 'slug'], to: value },
          ]),
        ),
      },
      meta,
    });
    return this.getOrganisation(organisationId);
  }

  async setOrganisationStatus(
    organisationId: string,
    status: 'active' | 'suspended' | 'archived',
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const [before] = await this.db
      .select({ status: organisations.status })
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!before) {
      throw new NotFoundException('Organisation not found.');
    }
    if (before.status === status) {
      throw new BadRequestException(`The organisation is already ${status}.`);
    }
    await this.db
      .update(organisations)
      .set({ status, updatedAt: new Date() })
      .where(eq(organisations.id, organisationId));
    await this.audit.record({
      action: 'organisation.status_changed',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: { from: before.status, to: status, reason, by: 'platform' },
      meta,
    });
    return this.getOrganisation(organisationId);
  }

  async updateBranding(
    organisationId: string,
    change: {
      displayName?: string | null;
      tagline?: string | null;
      primaryColour?: string;
      accentColour?: string;
    },
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.assertOrganisationExists(organisationId);
    await this.db
      .insert(organisationBranding)
      .values({ organisationId, ...change })
      .onConflictDoUpdate({
        target: organisationBranding.organisationId,
        set: { ...change, updatedAt: new Date() },
      });
    await this.audit.record({
      action: 'organisation.branding_updated',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: { fields: Object.keys(change), by: 'platform' },
      meta,
    });
    return this.getOrganisation(organisationId);
  }

  /** Records a subscription change made by the platform owner. No payment provider is involved yet. */
  async setSubscription(
    organisationId: string,
    change: SubscriptionChange,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const [organisation] = await this.db
      .select({ currentSubscriptionId: organisations.currentSubscriptionId })
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!organisation) {
      throw new NotFoundException('Organisation not found.');
    }
    const now = new Date();
    if (change.currentPeriodEnd && change.currentPeriodEnd <= now) {
      throw new BadRequestException('The period end date must be in the future.');
    }

    const before = organisation.currentSubscriptionId
      ? (
          await this.db
            .select()
            .from(subscriptions)
            .where(
              and(
                eq(subscriptions.id, organisation.currentSubscriptionId),
                eq(subscriptions.organisationId, organisationId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;

    await this.db.transaction(async (tx) => {
      if (before) {
        await tx
          .update(subscriptions)
          .set({
            planCode: change.planCode,
            status: change.status,
            currentPeriodEnd: change.currentPeriodEnd,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, before.id));
      } else {
        const [created] = await tx
          .insert(subscriptions)
          .values({
            organisationId,
            planCode: change.planCode,
            status: change.status,
            currentPeriodEnd: change.currentPeriodEnd,
          })
          .returning({ id: subscriptions.id });
        await tx
          .update(organisations)
          .set({ currentSubscriptionId: created!.id, updatedAt: now })
          .where(eq(organisations.id, organisationId));
      }
    });

    await this.audit.record({
      action: 'subscription.updated',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'subscription',
      targetId: before?.id,
      metadata: {
        from: before
          ? {
              planCode: before.planCode,
              status: before.status,
              currentPeriodEnd: before.currentPeriodEnd,
            }
          : null,
        to: change,
        by: 'platform',
        paymentProvider: 'none (manual)',
      },
      meta,
    });
    return this.getOrganisation(organisationId);
  }

  /** Suspends or reactivates an Owner's or Administrator's membership. */
  async setAdministratorStatus(
    organisationId: string,
    membershipId: string,
    status: 'active' | 'suspended',
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM memberships WHERE organisation_id = ${organisationId} FOR UPDATE`,
      );
      const [target] = await tx
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.id, membershipId), eq(memberships.organisationId, organisationId)),
        )
        .limit(1);
      if (!target || (target.role !== 'owner' && target.role !== 'admin')) {
        throw new NotFoundException('Administrator not found.');
      }
      if (target.status === status) {
        throw new BadRequestException(`This administrator is already ${status}.`);
      }
      if (target.role === 'owner' && status === 'suspended') {
        const [otherOwner] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organisationId, organisationId),
              eq(memberships.role, 'owner'),
              eq(memberships.status, 'active'),
              ne(memberships.id, membershipId),
            ),
          )
          .limit(1);
        if (!otherOwner) {
          throw new ConflictException(
            'This is the only active Owner. Invite another Owner before suspending this one.',
          );
        }
      }
      await tx
        .update(memberships)
        .set({ status, updatedAt: new Date() })
        .where(eq(memberships.id, membershipId));
      await this.audit.record({
        action: 'membership.status_changed',
        outcome: 'success',
        actorUserId,
        organisationId,
        targetType: 'membership',
        targetId: membershipId,
        metadata: {
          userId: target.userId,
          role: target.role,
          from: target.status,
          to: status,
          by: 'platform',
        },
        meta,
      });
    });
    return this.getOrganisation(organisationId);
  }

  /**
   * Restricted, audited access to an organisation's PUBLISHED constitution text, for support.
   * The reason is recorded in the platform audit log AND in the organisation's own audit log,
   * so the customer can see that their content was viewed, by whom and why.
   */
  async supportContentAccess(
    organisationId: string,
    reason: string,
    actorUserId: string,
    meta: RequestMeta,
  ) {
    await this.assertOrganisationExists(organisationId);
    // Read-only scope: "member" level sees published content only.
    const scope = createTenantScope(organisationId, actorUserId, 'member');
    const sectionsList = await this.tenantDb.run(scope, async (tx) => {
      const result = await tx.execute(sql`
        SELECT s.id, s.ref_key AS "refKey", s.number, s.heading, s.body, v.label AS "versionLabel"
        FROM sections s
        JOIN constitution_versions v ON v.id = s.version_id AND v.organisation_id = s.organisation_id
        WHERE s.organisation_id = ${organisationId} AND v.status = 'published'
        ORDER BY v.version_number DESC, s.position ASC
        LIMIT 500`);
      return result.rows as Row[];
    });
    await this.audit.record({
      action: 'support.content_accessed',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: { reason, scope: 'published_sections', sectionsReturned: sectionsList.length },
      meta,
    });
    return { sections: sectionsList };
  }

  async auditEvents(filter: AuditFilter) {
    const conditions: SQL[] = [sql`true`];
    if (filter.organisationId) conditions.push(sql`e.organisation_id = ${filter.organisationId}`);
    if (filter.actionPrefix) conditions.push(sql`e.action LIKE ${`${filter.actionPrefix}%`}`);
    if (filter.outcome) conditions.push(sql`e.outcome = ${filter.outcome}`);
    if (filter.before)
      conditions.push(sql`e.occurred_at < ${filter.before.toISOString()}::timestamptz`);
    return rowsOf<Row>(
      await this.db.execute(sql`
        SELECT e.id, e.occurred_at AS "occurredAt", e.action, e.outcome,
               e.organisation_id AS "organisationId", o.name AS "organisationName",
               e.actor_user_id AS "actorUserId", u.email AS "actorEmail",
               e.target_type AS "targetType", e.target_id AS "targetId",
               e.ip_address AS "ipAddress", e.request_id AS "requestId", e.metadata
        FROM audit_events e
        LEFT JOIN organisations o ON o.id = e.organisation_id
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY e.occurred_at DESC
        LIMIT ${filter.limit}`),
    );
  }

  /** Things that may need the platform owner's attention. Email addresses are masked. */
  async support() {
    const [counts] = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT
          (SELECT count(*) FROM audit_events WHERE action = 'auth.login.failed' AND occurred_at > now() - interval '24 hours')::int AS "failedLogins24h",
          (SELECT count(*) FROM audit_events WHERE action IN ('auth.login.rate_limited', 'auth.password.reset_rate_limited') AND occurred_at > now() - interval '24 hours')::int AS "rateLimited24h",
          (SELECT count(*) FROM audit_events WHERE action = 'permission.denied' AND occurred_at > now() - interval '24 hours')::int AS "permissionDenied24h",
          (SELECT count(*) FROM users WHERE status <> 'active')::int AS "inactiveAccounts",
          (SELECT count(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL
             AND expires_at <= now() AND created_at > now() - interval '30 days')::int AS "expiredInvitations30d"
      `),
    );
    const organisationsWithoutOwner = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT o.id, o.name FROM organisations o
        WHERE o.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM memberships m WHERE m.organisation_id = o.id AND m.role = 'owner' AND m.status = 'active')
        ORDER BY o.created_at DESC LIMIT 50`),
    );
    const trialsEndingSoon = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT o.id, o.name, s.current_period_end AS "currentPeriodEnd"
        FROM organisations o JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE s.status = 'trialing' AND s.current_period_end < now() + interval '7 days'
        ORDER BY s.current_period_end LIMIT 50`),
    );
    const paymentAttention = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT o.id, o.name, s.status FROM organisations o
        JOIN subscriptions s ON s.id = o.current_subscription_id AND s.organisation_id = o.id
        WHERE s.status IN ('past_due', 'suspended') ORDER BY o.name LIMIT 50`),
    );
    const recentSecurityEvents = rowsOf<Row>(
      await this.db.execute(sql`
        SELECT e.occurred_at AS "occurredAt", e.action, e.outcome, e.organisation_id AS "organisationId",
               e.target_type AS "targetType", e.target_id AS "targetId", e.ip_address AS "ipAddress"
        FROM audit_events e
        WHERE e.outcome IN ('failure', 'denied') AND e.occurred_at > now() - interval '7 days'
        ORDER BY e.occurred_at DESC LIMIT 25`),
    ).map((event) => ({
      ...event,
      targetId: event.targetType === 'email' ? maskEmail(event.targetId as string) : event.targetId,
    }));
    return {
      counts,
      organisationsWithoutOwner,
      trialsEndingSoon,
      paymentAttention,
      recentSecurityEvents,
    };
  }

  async health() {
    const started = Date.now();
    let database: { status: 'ok' | 'down'; latencyMs: number | null } = {
      status: 'down',
      latencyMs: null,
    };
    try {
      await pingDatabase(this.pool);
      database = { status: 'ok', latencyMs: Date.now() - started };
    } catch {
      database = { status: 'down', latencyMs: null };
    }

    let migrations: {
      status: 'ok' | 'pending' | 'unknown';
      applied: number | null;
      expected: number;
    } = {
      status: 'unknown',
      applied: null,
      expected: this.expectedMigrations(),
    };
    if (database.status === 'ok') {
      try {
        const [row] = rowsOf<{ applied: number }>(
          await this.db.execute(
            sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`,
          ),
        );
        const applied = row?.applied ?? 0;
        migrations = {
          status: applied >= migrations.expected ? 'ok' : 'pending',
          applied,
          expected: migrations.expected,
        };
      } catch {
        // leave as unknown
      }
    }

    const storageOk = await this.storage.checkWritable();
    const checks = {
      database,
      migrations,
      storage: { status: storageOk ? 'ok' : 'down', driver: this.config.STORAGE_DRIVER },
      email: {
        status: this.config.MAIL_TRANSPORT === 'log' ? 'development_log' : 'not_configured',
        transport: this.config.MAIL_TRANSPORT,
      },
    };
    const healthy = database.status === 'ok' && migrations.status === 'ok' && storageOk;
    return {
      status: healthy ? 'ok' : 'degraded',
      checks,
      version: this.config.APP_VERSION,
      environment: this.config.APP_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private expectedMigrations(): number {
    try {
      const journal = JSON.parse(
        readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };
      return journal.entries.length;
    } catch {
      return 0;
    }
  }

  private async assertOrganisationExists(organisationId: string): Promise<void> {
    const [found] = await this.db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!found) {
      throw new NotFoundException('Organisation not found.');
    }
  }
}
