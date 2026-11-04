import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  auditEvents,
  organisationDeletionRequests,
  organisations,
  users,
  type Database,
  type OrganisationDeletionRequest,
} from '@constitution/db';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../files/storage.service';
import { loadAccess } from '../subscriptions/access';

/**
 * The organisation's tables whose rows are DELETED, in the order they are counted. Rows in
 * sections, section_chunks, extracted_texts and constitution_versions go with their
 * constitutions (database cascades). Every table with an organisation_id must be listed here or
 * in KEPT_TABLES: a test fails otherwise, so a new table cannot be forgotten.
 */
export const DELETED_TABLES = [
  'ai_feedback',
  'ai_citations',
  'ai_messages',
  'ai_conversations',
  'approved_answer_sections',
  'approved_answers',
  'simplified_sections',
  'content_approvals',
  'section_chunks',
  'sections',
  'extracted_texts',
  'constitution_versions',
  'constitutions',
  'organisation_branding',
  'files',
  'usage_records',
  'invitations',
  'memberships',
] as const;

/** Kept as financial records (invoices, payments, receipts and how the subscription changed). */
export const KEPT_TABLES = ['subscriptions', 'invoices', 'payments', 'subscription_events'] as const;

/** Tables with an organisation_id handled separately: the audit log and these requests. */
export const SPECIAL_TABLES = ['audit_events', 'organisation_deletion_requests'] as const;

/** Deleted with explicit statements, children first. The rest go by cascade from these. */
const DELETE_ORDER = [
  'ai_feedback',
  'ai_citations',
  'ai_messages',
  'ai_conversations',
  'approved_answer_sections',
  'approved_answers',
  'simplified_sections',
  'content_approvals',
  'section_chunks',
  // Versions, their sections and extracted text go with the constitution (a section's
  // "drafts only" rule allows removal once its version is gone).
  'constitutions',
  'organisation_branding',
  // After the versions: a file that is a version's original document cannot be deleted before.
  'files',
  'usage_records',
  'invitations',
  'memberships',
] as const;

export const REQUEST_LIFETIME_MS = 7 * 24 * 3_600_000;
export const WAITING_PERIOD_MS = 24 * 3_600_000;

export const NOT_ELIGIBLE =
  'Only an organisation whose access has ended can be deleted: suspend it, or cancel its subscription and wait until access is restricted.';

export interface DeletionPreview {
  organisation: { id: string; name: string; slug: string; status: string; deletedAt: string | null };
  eligible: boolean;
  notEligibleReason: string | null;
  accessState: string;
  willDelete: Record<string, number>;
  auditEvents: number;
  accountsToDelete: number;
  accountsKept: number;
  financialRecordsKept: Record<string, number>;
  activeSuperAdmins: number;
  /** "second_person" (2+ Super Admins) or "waiting_period" (only one). */
  rule: 'second_person' | 'waiting_period';
  request: PublicRequest | null;
  lastCompleted: PublicRequest | null;
}

export interface PublicRequest {
  id: string;
  status: string;
  reason: string;
  requestedBy: { id: string | null; displayName: string | null };
  requestedAt: string;
  expiresAt: string;
  /** When the same person may confirm (only one Super Admin); null when a second person must. */
  confirmableFrom: string | null;
  approvedBy: { id: string | null; displayName: string | null } | null;
  approvalMode: string | null;
  completedAt: string | null;
  deletedCounts: Record<string, number> | null;
  filesRemoved: boolean;
}

/** Something with `execute`: the main database or a transaction. */
interface Executor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

async function countRows(
  executor: Executor,
  tables: readonly string[],
  organisationId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    // Table names come from the constant lists above, never from input.
    const result = await executor.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE organisation_id = ${organisationId}`,
    );
    counts[table] = Number((result.rows[0] as { n: number }).n);
  }
  return counts;
}

/**
 * Deletes one organisation's data after an approved request (Task D3).
 *
 * - Eligible only when the organisation's access has ended (suspended, archived, or the
 *   subscription restricted/suspended/none).
 * - Two or more active Super Admins: a DIFFERENT Super Admin approves. Only one: the same person
 *   may confirm after a 24-hour wait. Requests expire after 7 days and can be cancelled.
 * - One database transaction: content, members, invitations, branding, files records, usage, the
 *   organisation's audit events, and the accounts of people who belong to no other organisation
 *   (with their platform-level sign-in events). Invoices, payments, receipts and the
 *   subscription history are kept; the organisation row stays as a "deleted" marker with a
 *   freed web address. The deletion is recorded as a new audit event with counts only.
 * - Then the organisation's files folder is removed from storage (can be retried).
 */
@Injectable()
export class OrganisationDeletionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @InjectPinoLogger(OrganisationDeletionService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------

  async preview(organisationId: string): Promise<DeletionPreview> {
    const organisation = await this.findOrganisation(organisationId);
    const eligibility = await this.eligibility(organisation);
    const willDelete = await countRows(this.db, DELETED_TABLES, organisationId);
    const financialRecordsKept = await countRows(this.db, KEPT_TABLES, organisationId);
    const audit = await this.db.execute(
      sql`SELECT count(*)::int AS n FROM audit_events WHERE organisation_id = ${organisationId}`,
    );
    const accounts = await this.accountsOf(this.db, organisationId);
    const activeSuperAdmins = await this.activeSuperAdmins();
    const [pending] = await this.db
      .select()
      .from(organisationDeletionRequests)
      .where(
        and(
          eq(organisationDeletionRequests.organisationId, organisationId),
          eq(organisationDeletionRequests.status, 'pending'),
        ),
      )
      .limit(1);
    const [completed] = await this.db
      .select()
      .from(organisationDeletionRequests)
      .where(
        and(
          eq(organisationDeletionRequests.organisationId, organisationId),
          eq(organisationDeletionRequests.status, 'completed'),
        ),
      )
      .limit(1);
    return {
      organisation: {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
        status: organisation.status,
        deletedAt: organisation.deletedAt?.toISOString() ?? null,
      },
      eligible: eligibility.eligible,
      notEligibleReason: eligibility.eligible ? null : eligibility.reason,
      accessState: eligibility.accessState,
      willDelete,
      auditEvents: Number((audit.rows[0] as { n: number }).n),
      accountsToDelete: accounts.toDelete.length,
      accountsKept: accounts.kept,
      financialRecordsKept,
      activeSuperAdmins,
      rule: activeSuperAdmins >= 2 ? 'second_person' : 'waiting_period',
      request: pending ? await this.toPublic(pending, activeSuperAdmins) : null,
      lastCompleted: completed ? await this.toPublic(completed, activeSuperAdmins) : null,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Request, cancel, approve
  // ---------------------------------------------------------------------------------------

  async request(
    organisationId: string,
    input: { confirmSlug: string; reason: string; exportConfirmed: boolean },
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<DeletionPreview> {
    const organisation = await this.findOrganisation(organisationId);
    if (input.confirmSlug !== organisation.slug) {
      throw new BadRequestException(
        "Type the organisation's web address exactly, to confirm which one to delete.",
      );
    }
    if (!input.exportConfirmed) {
      throw new BadRequestException(
        'Confirm that the data was exported for the organisation, or that its owner declined an export.',
      );
    }
    const eligibility = await this.eligibility(organisation);
    if (!eligibility.eligible) {
      throw new ConflictException(eligibility.reason);
    }
    // An expired request no longer blocks a new one.
    await this.db
      .update(organisationDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(
        and(
          eq(organisationDeletionRequests.organisationId, organisationId),
          eq(organisationDeletionRequests.status, 'pending'),
          sql`${organisationDeletionRequests.expiresAt} <= now()`,
        ),
      );
    const now = Date.now();
    const inserted = await this.db
      .insert(organisationDeletionRequests)
      .values({
        organisationId,
        reason: input.reason,
        exportConfirmed: true,
        requestedByUserId: actorUserId,
        expiresAt: new Date(now + REQUEST_LIFETIME_MS),
      })
      .onConflictDoNothing()
      .returning({ id: organisationDeletionRequests.id });
    if (inserted.length === 0) {
      throw new ConflictException('A deletion request for this organisation is already waiting.');
    }
    await this.audit.record({
      action: 'organisation.deletion_requested',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: { requestId: inserted[0]!.id, reason: input.reason },
      meta,
    });
    return this.preview(organisationId);
  }

  async cancel(
    organisationId: string,
    requestId: string,
    actorUserId: string,
    meta: RequestMeta,
  ): Promise<DeletionPreview> {
    const cancelled = await this.db
      .update(organisationDeletionRequests)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelledByUserId: actorUserId })
      .where(
        and(
          eq(organisationDeletionRequests.id, requestId),
          eq(organisationDeletionRequests.organisationId, organisationId),
          eq(organisationDeletionRequests.status, 'pending'),
        ),
      )
      .returning({ id: organisationDeletionRequests.id });
    if (cancelled.length === 0) {
      throw new NotFoundException('There is no waiting deletion request to cancel.');
    }
    await this.audit.record({
      action: 'organisation.deletion_cancelled',
      outcome: 'success',
      actorUserId,
      organisationId,
      targetType: 'organisation',
      targetId: organisationId,
      metadata: { requestId },
      meta,
    });
    return this.preview(organisationId);
  }

  /**
   * Approves a waiting request and deletes the data. `actorUserId` null = the server command
   * line, which (like a single Super Admin) may confirm only after the 24-hour wait.
   */
  async approve(
    organisationId: string,
    requestId: string,
    confirmSlug: string,
    actorUserId: string | null,
    meta: RequestMeta,
  ): Promise<{ preview: DeletionPreview; filesRemoved: boolean }> {
    const organisation = await this.findOrganisation(organisationId);
    if (confirmSlug !== organisation.slug) {
      throw new BadRequestException(
        "Type the organisation's web address exactly, to confirm which one to delete.",
      );
    }
    const activeSuperAdmins = await this.activeSuperAdmins();

    const counts = await this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id FROM organisation_deletion_requests
        WHERE id = ${requestId} AND organisation_id = ${organisationId} AND status = 'pending'
        FOR UPDATE`);
      if (locked.rows.length === 0) {
        throw new NotFoundException('There is no waiting deletion request to approve.');
      }
      const [request] = await tx
        .select()
        .from(organisationDeletionRequests)
        .where(eq(organisationDeletionRequests.id, requestId));
      const now = Date.now();
      if (request!.expiresAt.getTime() <= now) {
        throw new ConflictException('This deletion request has expired. Request it again.');
      }
      let mode: 'second_person' | 'waiting_period' | 'command_line';
      const waitedEnough = now >= request!.requestedAt.getTime() + WAITING_PERIOD_MS;
      const confirmableFrom = new Date(request!.requestedAt.getTime() + WAITING_PERIOD_MS);
      if (actorUserId === null) {
        if (!waitedEnough) {
          throw new ConflictException(
            `From the command line, a deletion can be confirmed from ${confirmableFrom.toISOString()} (24 hours after the request).`,
          );
        }
        mode = 'command_line';
      } else if (activeSuperAdmins >= 2) {
        if (request!.requestedByUserId === actorUserId) {
          throw new ForbiddenException(
            'A different Super Admin must approve this deletion (there are two or more Super Admins).',
          );
        }
        mode = 'second_person';
      } else {
        if (!waitedEnough) {
          throw new ConflictException(
            `With only one Super Admin, the deletion can be confirmed from ${confirmableFrom.toISOString()} (24 hours after the request), or cancelled before then.`,
          );
        }
        mode = 'waiting_period';
      }

      await tx.execute(sql`SELECT id FROM organisations WHERE id = ${organisationId} FOR UPDATE`);
      const [current] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, organisationId));
      const eligibility = await this.eligibility(current!, tx);
      if (!eligibility.eligible) {
        throw new ConflictException(eligibility.reason);
      }

      const before = await countRows(tx, DELETED_TABLES, organisationId);
      const accounts = await this.accountsOf(tx, organisationId);

      // 1. Mark the organisation deleted and free its web address. Nobody can sign in to it now.
      await tx
        .update(organisations)
        .set({
          deletedAt: new Date(now),
          status: 'archived',
          slug: `deleted-${organisationId.replace(/-/g, '').slice(0, 12)}`,
          updatedAt: new Date(now),
        })
        .where(eq(organisations.id, organisationId));

      // 2. The organisation's own records, children first.
      for (const table of DELETE_ORDER) {
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE organisation_id = ${organisationId}`,
        );
      }
      const left = await countRows(tx, DELETED_TABLES, organisationId);
      const remaining = Object.entries(left).filter(([, count]) => count > 0);
      if (remaining.length > 0) {
        // Never expected; refuse to finish half a deletion.
        throw new Error(`Deletion left rows in: ${remaining.map(([name]) => name).join(', ')}`);
      }

      // 3. The organisation's audit events (allowed by the database only now that it is deleted).
      await tx.execute(
        sql`SELECT set_config('app.deleting_organisation_id', ${organisationId}, true)`,
      );
      const auditDeleted = await tx.execute(
        sql`DELETE FROM audit_events WHERE organisation_id = ${organisationId}`,
      );

      // 4. Accounts of people who belong to no other organisation, with their platform-level
      //    sign-in events. An account still linked to records that cannot change (for example a
      //    published version elsewhere) is kept rather than failing the whole deletion.
      let accountsDeleted = 0;
      let accountsKept = accounts.kept;
      let accountAuditEventsDeleted = 0;
      for (const account of accounts.toDelete) {
        try {
          await tx.transaction(async (savepoint) => {
            await savepoint.delete(users).where(eq(users.id, account.id));
            await savepoint.execute(
              sql`SELECT set_config('app.deleting_user_id', ${account.id}, true),
                         set_config('app.deleting_user_email', ${account.email}, true)`,
            );
            const removed = await savepoint.execute(sql`
              DELETE FROM audit_events
              WHERE organisation_id IS NULL
                AND (actor_user_id = ${account.id}::uuid OR target_id = ${account.id}
                     OR target_id = ${account.email})`);
            accountAuditEventsDeleted += removed.rowCount ?? 0;
          });
          accountsDeleted += 1;
        } catch {
          accountsKept += 1;
        }
      }
      await tx.execute(sql`SELECT set_config('app.deleting_user_id', '', true),
                                 set_config('app.deleting_user_email', '', true),
                                 set_config('app.deleting_organisation_id', '', true)`);

      const deletedCounts: Record<string, number> = {
        ...before,
        audit_events: auditDeleted.rowCount ?? 0,
        accounts: accountsDeleted,
        accounts_kept_other_organisations: accountsKept,
        account_audit_events: accountAuditEventsDeleted,
      };

      // 5. Close the request and record the deletion (counts only: no names or contents).
      await tx
        .update(organisationDeletionRequests)
        .set({
          status: 'completed',
          approvedByUserId: actorUserId,
          approvalMode: mode,
          completedAt: new Date(now),
          deletedCounts,
        })
        .where(eq(organisationDeletionRequests.id, requestId));
      await tx.insert(auditEvents).values({
        action: 'organisation.deleted',
        outcome: 'success',
        actorUserId,
        organisationId,
        targetType: 'organisation',
        targetId: organisationId,
        metadata: {
          requestId,
          requestedBy: request!.requestedByUserId,
          approvedBy: actorUserId ?? 'command_line',
          approvalMode: mode,
          reason: request!.reason,
          counts: deletedCounts,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
      return deletedCounts;
    });

    this.logger.info({ organisationId, counts }, 'Organisation data deleted');
    const filesRemoved = await this.removeFiles(organisationId);
    return { preview: await this.preview(organisationId), filesRemoved };
  }

  /** Removes the files folder of a deleted organisation (again). Safe to repeat. */
  async removeFiles(organisationId: string): Promise<boolean> {
    const organisation = await this.findOrganisation(organisationId);
    if (!organisation.deletedAt) {
      throw new ConflictException('Files are removed only for a deleted organisation.');
    }
    try {
      await this.storage.removeOrganisationFolder(organisationId);
      await this.db
        .update(organisationDeletionRequests)
        .set({ filesRemovedAt: new Date() })
        .where(
          and(
            eq(organisationDeletionRequests.organisationId, organisationId),
            eq(organisationDeletionRequests.status, 'completed'),
          ),
        );
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, organisationId },
        'Removing a deleted organisation’s files failed; run it again',
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  private async findOrganisation(organisationId: string) {
    const [organisation] = await this.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1);
    if (!organisation) {
      throw new NotFoundException('Organisation not found.');
    }
    return organisation;
  }

  private async eligibility(
    organisation: { id: string; status: string; deletedAt: Date | null },
    executor: Executor = this.db,
  ): Promise<{ eligible: boolean; reason: string; accessState: string }> {
    if (organisation.deletedAt) {
      return { eligible: false, reason: 'This organisation has already been deleted.', accessState: 'deleted' };
    }
    const access = await loadAccess(
      executor,
      organisation.id,
      new Date(),
      this.config.SUBSCRIPTION_DATA_RETENTION_DAYS,
    );
    const ended =
      organisation.status === 'suspended' ||
      organisation.status === 'archived' ||
      ['restricted', 'suspended', 'none'].includes(access.state);
    return { eligible: ended, reason: NOT_ELIGIBLE, accessState: access.state };
  }

  /** Members' accounts: deleted when they belong to no other organisation and are not staff. */
  private async accountsOf(
    executor: Executor,
    organisationId: string,
  ): Promise<{ toDelete: { id: string; email: string }[]; kept: number }> {
    const result = await executor.execute(sql`
      SELECT u.id::text AS id, u.email,
             (u.is_platform_super_admin OR EXISTS (
               SELECT 1 FROM memberships other
               WHERE other.user_id = u.id AND other.organisation_id <> ${organisationId}
             )) AS keep
      FROM users u
      WHERE u.id IN (SELECT m.user_id FROM memberships m WHERE m.organisation_id = ${organisationId})`);
    const rows = result.rows as { id: string; email: string; keep: boolean }[];
    return {
      toDelete: rows.filter((row) => !row.keep).map(({ id, email }) => ({ id, email })),
      kept: rows.filter((row) => row.keep).length,
    };
  }

  private async activeSuperAdmins(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS n FROM users
      WHERE is_platform_super_admin AND status = 'active'`);
    return Number((result.rows[0] as { n: number }).n);
  }

  private async displayName(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const [user] = await this.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.displayName ?? null;
  }

  private async toPublic(
    request: OrganisationDeletionRequest,
    activeSuperAdmins: number,
  ): Promise<PublicRequest> {
    return {
      id: request.id,
      status: request.status,
      reason: request.reason,
      requestedBy: {
        id: request.requestedByUserId,
        displayName: await this.displayName(request.requestedByUserId),
      },
      requestedAt: request.requestedAt.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      confirmableFrom:
        activeSuperAdmins >= 2
          ? null
          : new Date(request.requestedAt.getTime() + WAITING_PERIOD_MS).toISOString(),
      approvedBy:
        request.status === 'completed'
          ? {
              id: request.approvedByUserId,
              displayName: await this.displayName(request.approvedByUserId),
            }
          : null,
      approvalMode: request.approvalMode,
      completedAt: request.completedAt?.toISOString() ?? null,
      deletedCounts: request.deletedCounts ?? null,
      filesRemoved: request.filesRemovedAt !== null,
    };
  }
}
