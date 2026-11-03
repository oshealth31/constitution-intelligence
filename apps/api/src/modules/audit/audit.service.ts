import { Inject, Injectable } from '@nestjs/common';
import { auditEvents, type Database } from '@constitution/db';
import { desc, eq } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

/** Names of recorded events. Keep in sync with docs/security/authentication.md. */
export type AuditAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.login.rate_limited'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session.rejected'
  | 'auth.password.reset_requested'
  | 'auth.password.reset_rate_limited'
  | 'auth.password.reset_completed'
  | 'auth.password.reset_failed'
  | 'auth.password.changed'
  | 'auth.password.change_failed'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.accepted'
  | 'invitation.accept_failed'
  | 'membership.role_changed'
  | 'membership.status_changed'
  | 'membership.removed'
  | 'user.created'
  | 'user.status_changed'
  | 'user.super_admin_granted'
  | 'organisation.created'
  | 'organisation.updated'
  | 'organisation.status_changed'
  | 'organisation.branding_updated'
  | 'organisation.logo_updated'
  | 'organisation.logo_removed'
  | 'organisation.logo_rejected'
  | 'organisation.slug_changed'
  | 'user.profile_updated'
  | 'constitution.created'
  | 'document.uploaded'
  | 'document.rejected'
  | 'content.extracted'
  | 'content.section_edited'
  | 'content.section_added'
  | 'content.section_removed'
  | 'content.flag_resolved'
  | 'version.submitted'
  | 'version.approved'
  | 'version.changes_requested'
  | 'version.published'
  | 'version.archived'
  | 'ai.question_answered'
  | 'ai.feedback_given'
  | 'answer.created'
  | 'answer.updated'
  | 'answer.imported'
  | 'answer.approved'
  | 'answer.retired'
  | 'answer.restored'
  | 'answer.deleted'
  | 'simple_words.saved'
  | 'simple_words.imported'
  | 'simple_words.approved'
  | 'simple_words.withdrawn'
  | 'simple_words.deleted'
  | 'subscription.updated'
  | 'support.content_accessed'
  | 'permission.denied';

export interface AuditEntry {
  action: AuditAction;
  outcome: 'success' | 'failure' | 'denied';
  actorUserId?: string | null;
  organisationId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Extra facts. Never put passwords, tokens or session values here. */
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @InjectPinoLogger(AuditService.name) private readonly logger: PinoLogger,
    private readonly tenantDb: TenantDatabase,
  ) {}

  /**
   * Appends an event to the audit log. A failure to write is logged as an error but does
   * not break the user's request (the event is also visible in the structured logs).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        action: entry.action,
        outcome: entry.outcome,
        actorUserId: entry.actorUserId ?? null,
        organisationId: entry.organisationId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        requestId: entry.meta?.requestId ?? null,
      });
    } catch (error) {
      this.logger.error(
        { err: error, action: entry.action, outcome: entry.outcome },
        'Failed to write audit event',
      );
    }
  }

  /** An organisation's own audit events, read under Row-Level Security. */
  listForOrganisation(scope: TenantScope, limit: number) {
    return this.tenantDb.run(scope, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, scope.organisationId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(limit),
    );
  }

  listAll(limit: number) {
    return this.db.select().from(auditEvents).orderBy(desc(auditEvents.occurredAt)).limit(limit);
  }
}
