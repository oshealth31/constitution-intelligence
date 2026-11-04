import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { dataRequests, sessions, users, type Database, type DataRequest } from '@constitution/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { DRIZZLE } from '../../database/database.constants';
import { AuditService } from '../audit/audit.service';
import { hashToken } from '../auth/tokens';

export type DataRequestKind = 'copy' | 'correction' | 'deletion';

export interface NewDataRequest {
  kind: DataRequestKind;
  email: string;
  receivedOn: string;
  respondBy: string;
  receivedVia: string;
  identityCheck: string;
  details?: string | null;
}

export interface SubjectSummary {
  hasAccount: boolean;
  userId: string | null;
  displayName: string | null;
  status: string | null;
  isSuperAdmin: boolean;
  organisations: { id: string; name: string; role: string; status: string }[];
  /** Why the account cannot be deleted yet (empty when it can). */
  deletionBlockers: string[];
}

const REMOVED = '[removed]';

export function emailFingerprint(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** The text as it appears inside JSON, escaped for use in a regular expression. */
function jsonRegex(text: string): string {
  return JSON.stringify(text)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One person's request about their own personal data (Task D11): a copy of everything held
 * about them, a correction of their name or email, or deletion of their account.
 *
 * Deletion removes the account and everything that is only theirs (memberships, sign-ins,
 * two-step sign-in, reset links, invitations to their address, AI questions and feedback).
 * Records the organisation needs (versions, approvals, payments, answers) stay and show no
 * name. Their audit entries stay but are anonymised (decision A1): IP address, device, their
 * email and name are removed; what happened, when and where stay. Every step is audited.
 */
@Injectable()
export class DataRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(status?: string) {
    const result = await this.db.execute(sql`
      SELECT r.id, r.kind, r.status, r.subject_email AS "subjectEmail",
             r.subject_user_id IS NOT NULL AS "hasAccount",
             r.received_on::text AS "receivedOn", r.respond_by::text AS "respondBy",
             r.created_at AS "createdAt", r.completed_at AS "completedAt",
             r.cancelled_at AS "cancelledAt",
             (r.status = 'open' AND r.respond_by < current_date) AS overdue,
             c.display_name AS "createdBy"
      FROM data_requests r
      LEFT JOIN users c ON c.id = r.created_by_user_id
      WHERE ${status ? sql`r.status = ${status}` : sql`true`}
      ORDER BY (r.status = 'open') DESC, r.respond_by ASC, r.created_at DESC
      LIMIT 500`);
    return result.rows;
  }

  async create(input: NewDataRequest, actorUserId: string, meta: RequestMeta) {
    const email = input.email.trim().toLowerCase();
    if (input.respondBy < input.receivedOn) {
      throw new BadRequestException('The "respond by" date cannot be before the date received.');
    }
    const [subject] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const [created] = await this.db
      .insert(dataRequests)
      .values({
        kind: input.kind,
        subjectEmail: email,
        subjectEmailSha256: emailFingerprint(email),
        subjectUserId: subject?.id ?? null,
        receivedOn: input.receivedOn,
        respondBy: input.respondBy,
        receivedVia: input.receivedVia,
        identityCheck: input.identityCheck,
        details: input.details ?? null,
        createdByUserId: actorUserId,
      })
      .returning();
    // The audit entry names the request, never the person's email.
    await this.record('data_request.created', created!.id, actorUserId, meta, {
      kind: input.kind,
      accountFound: Boolean(subject),
    });
    return this.get(created!.id);
  }

  async get(id: string) {
    const request = await this.find(id);
    const [createdBy] = request.createdByUserId
      ? await this.db
          .select({ name: users.displayName })
          .from(users)
          .where(eq(users.id, request.createdByUserId))
      : [];
    const [completedBy] = request.completedByUserId
      ? await this.db
          .select({ name: users.displayName })
          .from(users)
          .where(eq(users.id, request.completedByUserId))
      : [];
    return {
      request: {
        ...request,
        createdBy: createdBy?.name ?? null,
        completedBy: completedBy?.name ?? null,
      },
      subject: await this.subject(request),
    };
  }

  /** Everything held about the person, as a readable JSON document (no secrets). */
  async copy(id: string, actorUserId: string | null, meta: RequestMeta) {
    const request = await this.find(id);
    this.assertOpen(request);
    const userId = await this.subjectId(request);
    const email = request.subjectEmail;
    const rows = async (query: ReturnType<typeof sql>) =>
      (await this.db.execute(query)).rows as Record<string, unknown>[];

    const [account] = await rows(sql`
      SELECT id, email, display_name AS "name", status,
             is_platform_super_admin AS "platformSuperAdmin",
             created_at AS "createdAt", updated_at AS "updatedAt",
             last_login_at AS "lastSignIn", password_changed_at AS "passwordLastChanged"
      FROM users WHERE id = ${userId}`);
    const document = {
      about:
        'Personal data held by Constitution Intelligence about one person, prepared for their request. ' +
        'Passwords, two-step secret keys, recovery codes and sign-in tokens are never included: only ' +
        'scrambled (hashed) versions are stored, and they are not personal information you can read.',
      preparedAt: new Date().toISOString(),
      requestReference: request.id,
      account: account ?? null,
      organisations: await rows(sql`
        SELECT o.name AS "organisation", m.role, m.status,
               m.created_at AS "memberSince", m.updated_at AS "lastChanged"
        FROM memberships m JOIN organisations o ON o.id = m.organisation_id
        WHERE m.user_id = ${userId} ORDER BY o.name`),
      twoStepSignIn: (
        await rows(sql`
          SELECT (t.enabled_at IS NOT NULL) AS "switchedOn", t.enabled_at AS "since",
                 (SELECT count(*)::int FROM two_step_recovery_codes c
                    WHERE c.user_id = ${userId} AND c.used_at IS NULL) AS "unusedRecoveryCodes"
          FROM user_two_step t WHERE t.user_id = ${userId}`)
      )[0] ?? { switchedOn: false },
      signIns: await rows(sql`
        SELECT created_at AS "signedIn", last_seen_at AS "lastActive", expires_at AS "expires",
               revoked_at AS "signedOut", revoked_reason AS "signedOutBecause",
               ip_address AS "ipAddress", user_agent AS "device"
        FROM sessions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1000`),
      passwordResetRequests: await rows(sql`
        SELECT created_at AS "requested", used_at AS "used", expires_at AS "expires"
        FROM password_reset_tokens WHERE user_id = ${userId} ORDER BY created_at DESC`),
      invitationsReceived: await rows(sql`
        SELECT o.name AS "organisation", i.role, i.created_at AS "sent",
               i.accepted_at AS "accepted", i.revoked_at AS "withdrawn", i.expires_at AS "expires"
        FROM invitations i JOIN organisations o ON o.id = i.organisation_id
        WHERE i.email = ${email} ORDER BY i.created_at DESC`),
      // Other people's email addresses are their data, so only counts are given here.
      invitationsSent: await rows(sql`
        SELECT o.name AS "organisation", count(*)::int AS "invitations"
        FROM invitations i JOIN organisations o ON o.id = i.organisation_id
        WHERE i.invited_by_user_id = ${userId} GROUP BY o.name ORDER BY o.name`),
      aiConversations: await rows(sql`
        SELECT o.name AS "organisation", c.title, c.created_at AS "started",
               coalesce((SELECT json_agg(json_build_object(
                   'from', CASE m.role WHEN 'user' THEN 'you' ELSE 'assistant' END,
                   'text', m.content, 'at', m.created_at) ORDER BY m.created_at)
                 FROM ai_messages m WHERE m.conversation_id = c.id
                   AND m.organisation_id = c.organisation_id), '[]'::json) AS "messages"
        FROM ai_conversations c JOIN organisations o ON o.id = c.organisation_id
        WHERE c.user_id = ${userId} ORDER BY c.created_at DESC`),
      aiFeedback: await rows(sql`
        SELECT o.name AS "organisation", f.helpful, f.comment, f.created_at AS "given"
        FROM ai_feedback f JOIN organisations o ON o.id = f.organisation_id
        WHERE f.user_id = ${userId} ORDER BY f.created_at DESC`),
      usage: await rows(sql`
        SELECT o.name AS "organisation", u.metric, sum(u.quantity)::int AS "total"
        FROM usage_records u JOIN organisations o ON o.id = u.organisation_id
        WHERE u.user_id = ${userId} GROUP BY o.name, u.metric ORDER BY 1, 2`),
      // Things the organisation keeps, where this person is named as the one who did them.
      recordsNamingYou: {
        filesUploaded: await rows(sql`
          SELECT o.name AS "organisation", f.original_filename AS "file", f.created_at AS "uploaded"
          FROM files f JOIN organisations o ON o.id = f.organisation_id
          WHERE f.uploaded_by_user_id = ${userId} ORDER BY f.created_at DESC`),
        versionsCreated: await rows(sql`
          SELECT o.name AS "organisation", v.label, v.version_number AS "version", v.created_at AS "created"
          FROM constitution_versions v JOIN organisations o ON o.id = v.organisation_id
          WHERE v.created_by_user_id = ${userId} ORDER BY v.created_at DESC`),
        reviewDecisions: await rows(sql`
          SELECT o.name AS "organisation", a.decision, a.comment, a.created_at AS "at"
          FROM content_approvals a JOIN organisations o ON o.id = a.organisation_id
          WHERE a.reviewer_user_id = ${userId} ORDER BY a.created_at DESC`),
        clausesEditedOrChecked: await rows(sql`
          SELECT o.name AS "organisation", count(*)::int AS "clauses"
          FROM sections s JOIN organisations o ON o.id = s.organisation_id
          WHERE s.edited_by_user_id = ${userId} OR s.reviewed_by_user_id = ${userId}
          GROUP BY o.name`),
        approvedAnswers: await rows(sql`
          SELECT o.name AS "organisation", a.question, a.status,
                 (a.created_by_user_id = ${userId}) AS "wrote",
                 (a.approved_by_user_id = ${userId}) AS "approved"
          FROM approved_answers a JOIN organisations o ON o.id = a.organisation_id
          WHERE ${userId} IN (a.created_by_user_id, a.updated_by_user_id, a.approved_by_user_id)`),
        simpleWordsTexts: await rows(sql`
          SELECT o.name AS "organisation", count(*)::int AS "texts"
          FROM simplified_sections s JOIN organisations o ON o.id = s.organisation_id
          WHERE ${userId} IN (s.created_by_user_id, s.updated_by_user_id, s.approved_by_user_id)
          GROUP BY o.name`),
        paymentsReported: await rows(sql`
          SELECT o.name AS "organisation", p.amount_minor AS "amountInThebe", p.currency,
                 p.method, p.reference, p.paid_on AS "paidOn", p.status, p.reported_at AS "reported"
          FROM payments p JOIN organisations o ON o.id = p.organisation_id
          WHERE p.reported_by_user_id = ${userId} ORDER BY p.reported_at DESC`),
      },
      // The activity log. Details of other people mentioned in an entry are left out.
      activityLog: await rows(sql`
        SELECT a.occurred_at AS "at", a.action, a.outcome, o.name AS "organisation",
               CASE WHEN a.actor_user_id = ${userId} THEN a.ip_address END AS "ipAddress",
               CASE WHEN a.actor_user_id = ${userId} THEN a.user_agent END AS "device",
               (a.actor_user_id = ${userId}) AS "byYou"
        FROM audit_events a LEFT JOIN organisations o ON o.id = a.organisation_id
        WHERE a.actor_user_id = ${userId} OR a.target_id = ${userId} OR a.target_id = ${email}
        ORDER BY a.occurred_at DESC LIMIT 5000`),
    };
    await this.record('data_request.copy_downloaded', id, actorUserId, meta, {
      kind: request.kind,
    });
    return {
      fileName: `personal-data-${request.id.slice(0, 8)}.json`,
      content: JSON.stringify(document, null, 2),
    };
  }

  /** Corrects the person's name and/or email (correction requests). */
  async correct(
    id: string,
    change: { displayName?: string; email?: string; reason: string },
    actorUserId: string,
    meta: RequestMeta,
  ) {
    const request = await this.find(id);
    this.assertOpen(request);
    if (request.kind !== 'correction') {
      throw new ConflictException('Only a correction request can change details.');
    }
    const userId = await this.subjectId(request);
    const [current] = await this.db.select().from(users).where(eq(users.id, userId));
    const fields: string[] = [];
    const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (change.displayName !== undefined && change.displayName !== current!.displayName) {
      update.displayName = change.displayName;
      fields.push('name');
    }
    const newEmail = change.email?.trim().toLowerCase();
    if (newEmail && newEmail !== current!.email) {
      const [taken] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, newEmail))
        .limit(1);
      if (taken) throw new ConflictException('Another account already uses that email address.');
      update.email = newEmail;
      fields.push('email');
    }
    if (fields.length === 0) throw new BadRequestException('Nothing to change.');
    await this.db.transaction(async (tx) => {
      await tx.update(users).set(update).where(eq(users.id, userId));
      if (update.email) {
        // A new sign-in address: end every session so the person signs in again with it.
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: 'email_corrected' })
          .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`));
      }
      await tx
        .update(dataRequests)
        .set({
          status: 'completed',
          completedAt: new Date(),
          completedByUserId: actorUserId,
          outcome: { corrected: fields, reason: change.reason },
        })
        .where(eq(dataRequests.id, id));
    });
    await this.record('data_request.corrected', id, actorUserId, meta, {
      fields,
      reason: change.reason,
    });
    return this.get(id);
  }

  /** Deletes the person's account and anonymises their audit entries (deletion requests). */
  async deletePerson(
    id: string,
    confirmEmail: string,
    reason: string,
    actorUserId: string | null,
    meta: RequestMeta,
  ) {
    const request = await this.find(id);
    this.assertOpen(request);
    if (request.kind !== 'deletion') {
      throw new ConflictException('Only a deletion request can delete an account.');
    }
    if (confirmEmail.trim().toLowerCase() !== request.subjectEmail) {
      throw new BadRequestException("Type the person's email address exactly to confirm.");
    }
    const subject = await this.subject(request);
    if (!subject.hasAccount || !subject.userId) {
      throw new ConflictException('There is no account with this email address.');
    }
    if (subject.deletionBlockers.length > 0) {
      throw new ConflictException(subject.deletionBlockers.join(' '));
    }
    const userId = subject.userId;
    const email = request.subjectEmail;
    const name = subject.displayName ?? '';
    if (userId === actorUserId) throw new ConflictException('You cannot delete your own account.');

    const counts = await this.db.transaction(async (tx) => {
      const count = async (query: ReturnType<typeof sql>) =>
        ((await tx.execute(query)).rows[0] as { n: number }).n;
      const before = {
        memberships: await count(
          sql`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${userId}`,
        ),
        signIns: await count(
          sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${userId}`,
        ),
        aiConversations: await count(
          sql`SELECT count(*)::int AS n FROM ai_conversations WHERE user_id = ${userId}`,
        ),
        aiFeedback: await count(
          sql`SELECT count(*)::int AS n FROM ai_feedback WHERE user_id = ${userId}`,
        ),
      };
      const invitations = await tx.execute(sql`DELETE FROM invitations WHERE email = ${email}`);
      await tx.execute(
        sql`DELETE FROM auth_rate_limits WHERE key = ${`login:email:${hashToken(email)}`}`,
      );
      // The account: its memberships, sign-ins, two-step sign-in, reset links, AI questions and
      // feedback go with it (ON DELETE CASCADE); records the organisation keeps lose the name
      // (ON DELETE SET NULL).
      await tx.delete(users).where(eq(users.id, userId));

      // Decision A1: keep the audit entries, without anything that identifies the person.
      await tx.execute(sql`SELECT set_config('app.anonymising_user_id', ${userId}, true),
                                 set_config('app.anonymising_user_email', ${email}, true)`);
      const emailPattern = jsonRegex(email);
      const namedPattern = name ? `${jsonRegex(name)} \\(${emailPattern}\\)` : null;
      const anonymised = await tx.execute(sql`
        UPDATE audit_events SET
          ip_address = CASE WHEN actor_user_id = ${userId}::uuid THEN NULL ELSE ip_address END,
          user_agent = CASE WHEN actor_user_id = ${userId}::uuid THEN NULL ELSE user_agent END,
          target_id = CASE WHEN target_id = ${userId} OR lower(target_id) = ${email}
                           THEN ${REMOVED} ELSE target_id END,
          metadata = regexp_replace(
                       ${
                         namedPattern
                           ? sql`regexp_replace(metadata::text, ${namedPattern}, ${REMOVED}, 'gi')`
                           : sql`metadata::text`
                       },
                       ${emailPattern}, ${REMOVED}, 'gi')::jsonb
        WHERE actor_user_id = ${userId}::uuid OR target_id = ${userId}
           OR lower(target_id) = ${email}
           OR position(${email} IN lower(metadata::text)) > 0`);
      await tx.execute(sql`SELECT set_config('app.anonymising_user_id', '', true),
                                 set_config('app.anonymising_user_email', '', true)`);

      const outcome = {
        ...before,
        invitations: invitations.rowCount ?? 0,
        auditEntriesAnonymised: anonymised.rowCount ?? 0,
        reason,
      };
      // This request (and any other about the same person) keeps only the fingerprint.
      await tx
        .update(dataRequests)
        .set({ subjectEmail: REMOVED })
        .where(eq(dataRequests.subjectEmailSha256, request.subjectEmailSha256));
      await tx
        .update(dataRequests)
        .set({
          status: 'completed',
          completedAt: new Date(),
          completedByUserId: actorUserId,
          outcome,
        })
        .where(eq(dataRequests.id, id));
      return outcome;
    });
    await this.record('data_request.person_deleted', id, actorUserId, meta, counts);
    return this.get(id);
  }

  /** Marks a copy request as answered (after the file was sent to the person). */
  async complete(id: string, note: string, actorUserId: string, meta: RequestMeta) {
    const request = await this.find(id);
    this.assertOpen(request);
    if (request.kind !== 'copy') {
      throw new ConflictException(
        'Corrections and deletions are completed by making the change itself.',
      );
    }
    await this.db
      .update(dataRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
        completedByUserId: actorUserId,
        outcome: { note },
      })
      .where(eq(dataRequests.id, id));
    await this.record('data_request.completed', id, actorUserId, meta, { kind: request.kind });
    return this.get(id);
  }

  async cancel(id: string, reason: string, actorUserId: string, meta: RequestMeta) {
    const request = await this.find(id);
    this.assertOpen(request);
    await this.db
      .update(dataRequests)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledByUserId: actorUserId,
        cancelReason: reason,
      })
      .where(eq(dataRequests.id, id));
    await this.record('data_request.cancelled', id, actorUserId, meta, {
      kind: request.kind,
      reason,
    });
    return this.get(id);
  }

  private async find(id: string): Promise<DataRequest> {
    const [request] = await this.db
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.id, id))
      .limit(1);
    if (!request) throw new NotFoundException('Request not found.');
    return request;
  }

  private assertOpen(request: DataRequest) {
    if (request.status !== 'open') {
      throw new ConflictException(`This request is already ${request.status}.`);
    }
  }

  /** The account the request is about, found by email when the request was made or now. */
  private async subjectId(request: DataRequest): Promise<string> {
    const subject = await this.subject(request);
    if (!subject.userId)
      throw new ConflictException('There is no account with this email address.');
    return subject.userId;
  }

  private async subject(request: DataRequest): Promise<SubjectSummary> {
    const [account] =
      request.subjectEmail === REMOVED
        ? []
        : await this.db
            .select()
            .from(users)
            .where(
              request.subjectUserId
                ? eq(users.id, request.subjectUserId)
                : eq(users.email, request.subjectEmail),
            )
            .limit(1);
    if (!account) {
      return {
        hasAccount: false,
        userId: null,
        displayName: null,
        status: null,
        isSuperAdmin: false,
        organisations: [],
        deletionBlockers: [],
      };
    }
    const result = await this.db.execute(sql`
      SELECT o.id, o.name, m.role, m.status,
             (m.role = 'owner' AND m.status = 'active' AND o.deleted_at IS NULL
              AND o.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM memberships other
                WHERE other.organisation_id = m.organisation_id AND other.user_id <> m.user_id
                  AND other.role = 'owner' AND other.status = 'active')) AS "lastOwner"
      FROM memberships m JOIN organisations o ON o.id = m.organisation_id
      WHERE m.user_id = ${account.id}
      ORDER BY o.name`);
    const memberships = result.rows as {
      id: string;
      name: string;
      role: string;
      status: string;
      lastOwner: boolean;
    }[];
    const blockers: string[] = [];
    if (account.isPlatformSuperAdmin) {
      blockers.push(
        'This is a Super Admin account: it cannot be deleted with this tool. Remove the Super Admin rights on the server first.',
      );
    }
    for (const membership of memberships.filter((row) => row.lastOwner)) {
      blockers.push(
        `They are the only Owner of ${membership.name}. Make someone else an Owner there first.`,
      );
    }
    return {
      hasAccount: true,
      userId: account.id,
      displayName: account.displayName,
      status: account.status,
      isSuperAdmin: account.isPlatformSuperAdmin,
      organisations: memberships.map(({ id, name, role, status }) => ({ id, name, role, status })),
      deletionBlockers: blockers,
    };
  }

  private async record(
    action:
      | 'data_request.created'
      | 'data_request.copy_downloaded'
      | 'data_request.corrected'
      | 'data_request.person_deleted'
      | 'data_request.completed'
      | 'data_request.cancelled',
    requestId: string,
    actorUserId: string | null,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record({
      action,
      outcome: 'success',
      actorUserId,
      targetType: 'data_request',
      targetId: requestId,
      metadata,
      meta,
    });
  }

  /** For tests and the command line: the newest requests first. */
  async latest(limit = 20) {
    return this.db.select().from(dataRequests).orderBy(desc(dataRequests.createdAt)).limit(limit);
  }
}
