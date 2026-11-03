import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { approvedAnswers, approvedAnswerSections, users } from '@constitution/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { questionTerms } from '../ai/ai-retrieval.service';
import { AuditService } from '../audit/audit.service';
import {
  computeReferences,
  matchesReference,
  parseReferenceQuery,
  type SectionReference,
} from '../constitutions/references';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { checkAnswer, hasBlockingIssue, type CheckIssue } from './answer-checks';

export const APPROVED_ANSWER_DISCLAIMER =
  'This explains your constitution in everyday words. It is not legal advice and is not a decision by the organisation. The original wording of the constitution is what counts.';

export type AnswerStatus = (typeof approvedAnswers.$inferSelect)['status'];
export type AnswerSource = (typeof approvedAnswers.$inferSelect)['source'];

/** A clause linked to an answer, with its original wording exactly as stored. */
export interface LinkedClauseView {
  sectionId: string;
  refKey: string;
  kind: string;
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  location: string;
  text: string;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  versionStatus: string;
  publishedAt: string | null;
  published: boolean;
}

/** What owners, administrators and content reviewers see. */
export interface ManagedAnswer {
  id: string;
  question: string;
  answer: string;
  status: AnswerStatus;
  source: AnswerSource;
  reviewReason: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clauses: LinkedClauseView[];
  issues: CheckIssue[];
  /** True when nothing blocks approval (warnings may remain). */
  readyToApprove: boolean;
}

/** What members see: approved answers only. */
export interface MemberAnswer {
  id: string;
  question: string;
  answer: string;
  approvedAt: string | null;
  clauses: Omit<LinkedClauseView, 'versionStatus' | 'published'>[];
}

export interface AnswerInput {
  question: string;
  answer: string;
  /** Clause references as shown in the reader, e.g. "7", "7(a)", "Part 2". */
  clauses: string[];
}

export interface ImportRow extends AnswerInput {
  draftedBy?: 'ai' | 'person';
}

export interface ImportReport {
  created: { id: string; question: string; unresolved: string[] }[];
}

interface SectionRow {
  id: string;
  versionId: string;
  parentSectionId: string | null;
  kind: string;
  refKey: string;
  number: string | null;
  heading: string | null;
  body: string;
  position: number;
  sourcePage: number | null;
}

interface VersionRow {
  versionId: string;
  versionNumber: number;
  label: string;
  status: string;
  publishedAt: Date | string | null;
  constitutionId: string;
  title: string;
}

/** Sections of some versions, with references worked out from stored numbers only. */
interface Loaded {
  versions: Map<string, VersionRow>;
  sections: Map<string, SectionRow>;
  references: Map<string, SectionReference>;
}

const MEMBER_MATCHES = 3;

/**
 * Approved answers: questions and plain-language answers that an organisation writes (or
 * imports) and an owner or administrator approves after checking them against the original
 * clauses. Members only ever see approved answers whose clauses are all in the current published
 * constitution. Everything runs under Row-Level Security for the caller's organisation.
 */
@Injectable()
export class ApprovedAnswersService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  // ----- Managing -----------------------------------------------------------------------------

  list(scope: TenantScope): Promise<ManagedAnswer[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(approvedAnswers)
        .where(eq(approvedAnswers.organisationId, scope.organisationId))
        .orderBy(desc(approvedAnswers.updatedAt));
      return this.toManaged(tx, scope, rows);
    });
  }

  get(scope: TenantScope, id: string): Promise<ManagedAnswer> {
    return this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, id);
      return (await this.toManaged(tx, scope, [row]))[0]!;
    });
  }

  async create(
    scope: TenantScope,
    input: AnswerInput,
    meta: RequestMeta,
    source: AnswerSource = 'manual',
  ): Promise<ManagedAnswer> {
    const id = await this.tenantDb.run(scope, async (tx) => {
      const resolved = await this.resolveClauses(tx, scope, input.clauses);
      if (resolved.unresolved.length > 0) {
        throw new BadRequestException(unresolvedMessage(resolved.unresolved));
      }
      return this.insert(tx, scope, input, resolved.sectionIds, source, null);
    });
    await this.record(scope, 'answer.created', id, meta, { source });
    return this.get(scope, id);
  }

  /** Editing always returns the answer to "draft": it is hidden from members until re-approved. */
  async update(
    scope: TenantScope,
    id: string,
    input: Partial<AnswerInput>,
    meta: RequestMeta,
  ): Promise<ManagedAnswer> {
    const wasApproved = await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.status === 'retired') {
        throw new ConflictException('This answer is retired. Restore it before editing.');
      }
      if (input.clauses) {
        const resolved = await this.resolveClauses(tx, scope, input.clauses);
        if (resolved.unresolved.length > 0) {
          throw new BadRequestException(unresolvedMessage(resolved.unresolved));
        }
        await this.replaceLinks(tx, scope, id, resolved.sectionIds);
      }
      await tx
        .update(approvedAnswers)
        .set({
          ...(input.question !== undefined ? { question: input.question } : {}),
          ...(input.answer !== undefined ? { answer: input.answer } : {}),
          status: 'draft',
          reviewReason: input.clauses ? null : row.reviewReason,
          approvedAt: null,
          approvedByUserId: null,
          updatedByUserId: scope.userId,
          updatedAt: new Date(),
        })
        .where(this.match(scope, id));
      return row.status === 'approved';
    });
    await this.record(scope, 'answer.updated', id, meta, { wasApproved });
    return this.get(scope, id);
  }

  /** Imports drafts (for example prepared outside the platform). Nothing is approved by importing. */
  async import(scope: TenantScope, rows: ImportRow[], meta: RequestMeta): Promise<ImportReport> {
    const report = await this.tenantDb.run(scope, async (tx) => {
      const created: ImportReport['created'] = [];
      for (const row of rows) {
        const resolved = await this.resolveClauses(tx, scope, row.clauses);
        const reason =
          resolved.unresolved.length > 0
            ? `Imported: ${unresolvedMessage(resolved.unresolved)}`
            : null;
        const id = await this.insert(
          tx,
          scope,
          row,
          resolved.sectionIds,
          row.draftedBy === 'ai' ? 'ai' : 'import',
          reason,
        );
        created.push({ id, question: row.question, unresolved: resolved.unresolved });
      }
      return { created };
    });
    await this.record(scope, 'answer.imported', scope.organisationId, meta, {
      count: report.created.length,
      unresolved: report.created.filter((row) => row.unresolved.length > 0).length,
    });
    return report;
  }

  /**
   * Draft (or needs review) → approved. Only owners and administrators reach this (checked by the
   * controller). The automatic checks must pass and the approver must confirm they read the answer
   * against the original clauses. The same person may have written it: who approved is recorded.
   */
  async approve(
    scope: TenantScope,
    id: string,
    confirmed: boolean,
    meta: RequestMeta,
  ): Promise<ManagedAnswer> {
    if (!confirmed) {
      throw new BadRequestException(
        'Please confirm that you have read this answer against the original clauses.',
      );
    }
    const warnings = await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.status !== 'draft' && row.status !== 'needs_review') {
        throw new ConflictException(
          `Only a draft can be approved. This answer is ${statusLabel(row.status)}.`,
        );
      }
      const [managed] = await this.toManaged(tx, scope, [row]);
      if (hasBlockingIssue(managed!.issues)) {
        throw new ConflictException(
          `This answer cannot be approved yet: ${managed!.issues
            .filter((issue) => issue.blocking)
            .map((issue) => issue.message)
            .join(' ')}`,
        );
      }
      await tx
        .update(approvedAnswers)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedByUserId: scope.userId,
          reviewReason: null,
          updatedAt: new Date(),
        })
        .where(this.match(scope, id));
      return {
        warnings: managed!.issues.length,
        ownDraft: row.createdByUserId === scope.userId || row.updatedByUserId === scope.userId,
        source: row.source,
      };
    });
    await this.record(scope, 'answer.approved', id, meta, warnings);
    return this.get(scope, id);
  }

  async retire(scope: TenantScope, id: string, meta: RequestMeta): Promise<ManagedAnswer> {
    await this.setStatus(scope, id, ['draft', 'approved', 'needs_review'], 'retired');
    await this.record(scope, 'answer.retired', id, meta, {});
    return this.get(scope, id);
  }

  async restore(scope: TenantScope, id: string, meta: RequestMeta): Promise<ManagedAnswer> {
    await this.setStatus(scope, id, ['retired'], 'draft');
    await this.record(scope, 'answer.restored', id, meta, {});
    return this.get(scope, id);
  }

  /** Approved answers must be retired first, so nothing members can see disappears by accident. */
  async remove(scope: TenantScope, id: string, meta: RequestMeta): Promise<void> {
    await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (row.status === 'approved') {
        throw new ConflictException('Retire this approved answer before deleting it.');
      }
      await tx.delete(approvedAnswers).where(this.match(scope, id));
    });
    await this.record(scope, 'answer.deleted', id, meta, {});
  }

  // ----- Members ------------------------------------------------------------------------------

  /** Every approved answer whose clauses are all in the current published constitution. */
  listApproved(scope: TenantScope): Promise<MemberAnswer[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(approvedAnswers)
        .where(
          and(
            eq(approvedAnswers.organisationId, scope.organisationId),
            eq(approvedAnswers.status, 'approved'),
          ),
        )
        .orderBy(asc(approvedAnswers.question));
      return this.toMember(tx, scope, rows);
    });
  }

  /** Approved answers that match a question typed by a member (best first, at most 3). */
  matchApproved(scope: TenantScope, question: string): Promise<MemberAnswer[]> {
    const terms = questionTerms(question);
    if (terms.length === 0) return Promise.resolve([]);
    return this.tenantDb.run(scope, async (tx) => {
      const tsquery = terms.map((term) => (term.length >= 4 ? `${term}:*` : term)).join(' | ');
      const ranked = (
        await tx.execute(sql`
          SELECT a.id, a.question, ts_rank_cd(a.search_vector, q) AS rank
          FROM approved_answers a CROSS JOIN to_tsquery('simple', ${tsquery}) AS q
          WHERE a.organisation_id = ${scope.organisationId} AND a.status = 'approved'
            AND a.search_vector @@ q
          ORDER BY rank DESC LIMIT 20`)
      ).rows as { id: string; question: string; rank: number | string }[];
      // A real overlap with the stored question: at least 40% of the meaningful words.
      const needed = Math.max(1, Math.ceil(terms.length * 0.4));
      const scored = ranked
        .map((row) => {
          const stored = row.question.toLowerCase();
          const covered = terms.filter((term) => stored.includes(term)).length;
          return { id: row.id, covered, score: covered * 3 + Number(row.rank) };
        })
        .filter((row) => row.covered >= needed)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 0) return [];
      const rows = await tx
        .select()
        .from(approvedAnswers)
        .where(
          and(
            eq(approvedAnswers.organisationId, scope.organisationId),
            inArray(
              approvedAnswers.id,
              scored.map((row) => row.id),
            ),
          ),
        );
      const order = new Map(scored.map((row, index) => [row.id, index]));
      rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      return (await this.toMember(tx, scope, rows)).slice(0, MEMBER_MATCHES);
    });
  }

  // ----- Helpers ------------------------------------------------------------------------------

  private match(scope: TenantScope, id: string) {
    return and(eq(approvedAnswers.id, id), eq(approvedAnswers.organisationId, scope.organisationId));
  }

  private async find(tx: TenantTransaction, scope: TenantScope, id: string, lock = false) {
    const query = tx.select().from(approvedAnswers).where(this.match(scope, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new NotFoundException('Answer not found.');
    return row;
  }

  private async setStatus(
    scope: TenantScope,
    id: string,
    from: AnswerStatus[],
    to: AnswerStatus,
  ): Promise<void> {
    await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, id, true);
      if (!from.includes(row.status)) {
        throw new ConflictException(
          `This step is not possible for an answer that is ${statusLabel(row.status)}.`,
        );
      }
      await tx
        .update(approvedAnswers)
        .set({
          status: to,
          updatedAt: new Date(),
          updatedByUserId: scope.userId,
          ...(to !== 'approved' ? { approvedAt: null, approvedByUserId: null } : {}),
        })
        .where(this.match(scope, id));
    });
  }

  private async insert(
    tx: TenantTransaction,
    scope: TenantScope,
    input: AnswerInput,
    sectionIds: string[],
    source: AnswerSource,
    reviewReason: string | null,
  ): Promise<string> {
    const [row] = await tx
      .insert(approvedAnswers)
      .values({
        organisationId: scope.organisationId,
        question: input.question,
        answer: input.answer,
        source,
        reviewReason,
        createdByUserId: scope.userId,
        updatedByUserId: scope.userId,
      })
      .returning({ id: approvedAnswers.id });
    await this.replaceLinks(tx, scope, row!.id, sectionIds);
    return row!.id;
  }

  private async replaceLinks(
    tx: TenantTransaction,
    scope: TenantScope,
    answerId: string,
    sectionIds: string[],
  ) {
    await tx
      .delete(approvedAnswerSections)
      .where(
        and(
          eq(approvedAnswerSections.answerId, answerId),
          eq(approvedAnswerSections.organisationId, scope.organisationId),
        ),
      );
    if (sectionIds.length === 0) return;
    await tx.insert(approvedAnswerSections).values(
      sectionIds.map((sectionId, position) => ({
        organisationId: scope.organisationId,
        answerId,
        sectionId,
        position,
      })),
    );
  }

  /**
   * Turns references such as "7", "Clause 7(a)" or "Part 2" into sections of the CURRENT
   * PUBLISHED versions. A reference found in more than one published document is not guessed.
   */
  private async resolveClauses(
    tx: TenantTransaction,
    scope: TenantScope,
    references: readonly string[],
  ): Promise<{ sectionIds: string[]; unresolved: string[] }> {
    const loaded = await loadSections(tx, scope.organisationId, { published: true });
    const sectionIds: string[] = [];
    const unresolved: string[] = [];
    for (const raw of references) {
      const text = raw.trim();
      const query = parseReferenceQuery(text);
      const matches = query
        ? [...loaded.sections.values()].filter((section) =>
            matchesReference(query, section, loaded.references.get(section.id)),
          )
        : [];
      if (matches.length !== 1) {
        unresolved.push(query?.display ?? text);
        continue;
      }
      if (!sectionIds.includes(matches[0]!.id)) sectionIds.push(matches[0]!.id);
    }
    return { sectionIds, unresolved };
  }

  /** Linked clauses for each answer, in order. */
  private async clausesFor(
    tx: TenantTransaction,
    scope: TenantScope,
    answerIds: string[],
  ): Promise<Map<string, LinkedClauseView[]>> {
    const result = new Map<string, LinkedClauseView[]>(answerIds.map((id) => [id, []]));
    if (answerIds.length === 0) return result;
    const links = await tx
      .select()
      .from(approvedAnswerSections)
      .where(
        and(
          eq(approvedAnswerSections.organisationId, scope.organisationId),
          inArray(approvedAnswerSections.answerId, answerIds),
        ),
      )
      .orderBy(asc(approvedAnswerSections.position));
    if (links.length === 0) return result;
    const versionIds = (
      (
        await tx.execute(sql`
          SELECT DISTINCT version_id AS "versionId" FROM sections
          WHERE organisation_id = ${scope.organisationId}
            AND id IN (${sql.join(
              links.map((link) => sql`${link.sectionId}`),
              sql`, `,
            )})`)
      ).rows as { versionId: string }[]
    ).map((row) => row.versionId);
    const loaded = await loadSections(tx, scope.organisationId, { versionIds });
    for (const link of links) {
      const view = clauseView(loaded, link.sectionId);
      if (view) result.get(link.answerId)!.push(view);
    }
    return result;
  }

  private async names(tx: TenantTransaction, ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, wanted));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async toManaged(
    tx: TenantTransaction,
    scope: TenantScope,
    rows: (typeof approvedAnswers.$inferSelect)[],
  ): Promise<ManagedAnswer[]> {
    const clauses = await this.clausesFor(
      tx,
      scope,
      rows.map((row) => row.id),
    );
    const names = await this.names(
      tx,
      rows.flatMap((row) => [row.createdByUserId, row.updatedByUserId, row.approvedByUserId]),
    );
    return rows.map((row) => {
      const linked = clauses.get(row.id) ?? [];
      const issues = checkAnswer(
        row.answer,
        linked.map((clause) => ({ ...clause, body: clause.text })),
      );
      return {
        id: row.id,
        question: row.question,
        answer: row.answer,
        status: row.status,
        source: row.source,
        reviewReason: row.reviewReason,
        createdBy: row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
        updatedBy: row.updatedByUserId ? (names.get(row.updatedByUserId) ?? null) : null,
        approvedBy: row.approvedByUserId ? (names.get(row.approvedByUserId) ?? null) : null,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        clauses: linked,
        issues,
        readyToApprove: !hasBlockingIssue(issues),
      };
    });
  }

  /** Only approved answers whose every clause is in a current published version. */
  private async toMember(
    tx: TenantTransaction,
    scope: TenantScope,
    rows: (typeof approvedAnswers.$inferSelect)[],
  ): Promise<MemberAnswer[]> {
    const approved = rows.filter((row) => row.status === 'approved');
    const clauses = await this.clausesFor(
      tx,
      scope,
      approved.map((row) => row.id),
    );
    const visible: MemberAnswer[] = [];
    for (const row of approved) {
      const linked = clauses.get(row.id) ?? [];
      if (linked.length === 0 || linked.some((clause) => !clause.published)) continue;
      visible.push({
        id: row.id,
        question: row.question,
        answer: row.answer,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        clauses: linked.map(({ versionStatus: _status, published: _published, ...clause }) => clause),
      });
    }
    return visible;
  }

  private record(
    scope: TenantScope,
    action: Parameters<AuditService['record']>[0]['action'],
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType: 'approved_answer',
      targetId,
      metadata,
      meta,
    });
  }
}

// ----- Shared with document publishing ----------------------------------------------------------

/**
 * Called inside the transaction that publishes a new version. Links to the replaced version are
 * moved to the new version when the clause kept the same reference AND exactly the same wording.
 * If any linked clause changed or disappeared, an approved answer becomes "needs review" (hidden
 * from members) and says which clauses to check. Nothing is rewritten automatically.
 */
export async function carryOverAnswers(
  tx: TenantTransaction,
  organisationId: string,
  fromVersionIds: readonly string[],
  toVersionId: string,
): Promise<{ carried: number; needsReview: number }> {
  if (fromVersionIds.length === 0) return { carried: 0, needsReview: 0 };
  const loaded = await loadSections(tx, organisationId, {
    versionIds: [...fromVersionIds, toVersionId],
  });
  const fromIds = new Set(fromVersionIds);
  const oldSectionIds = [...loaded.sections.values()]
    .filter((section) => fromIds.has(section.versionId))
    .map((section) => section.id);
  if (oldSectionIds.length === 0) return { carried: 0, needsReview: 0 };
  const links = await tx
    .select()
    .from(approvedAnswerSections)
    .where(
      and(
        eq(approvedAnswerSections.organisationId, organisationId),
        inArray(approvedAnswerSections.sectionId, oldSectionIds),
      ),
    );
  if (links.length === 0) return { carried: 0, needsReview: 0 };

  const key = (section: SectionRow) =>
    `${section.kind}|${loaded.references.get(section.id)?.reference ?? `#${section.heading ?? ''}`}|${normaliseWording(
      `${section.heading ?? ''}\n${section.body}`,
    )}`;
  const newByKey = new Map<string, string>();
  for (const section of loaded.sections.values()) {
    if (section.versionId === toVersionId) newByKey.set(key(section), section.id);
  }

  const changed = new Map<string, string[]>(); // answer id → labels of clauses that changed
  const carriedAnswers = new Set<string>();
  for (const link of links) {
    const old = loaded.sections.get(link.sectionId)!;
    const replacement = newByKey.get(key(old));
    if (replacement) {
      await tx
        .delete(approvedAnswerSections)
        .where(
          and(
            eq(approvedAnswerSections.answerId, link.answerId),
            eq(approvedAnswerSections.sectionId, replacement),
            eq(approvedAnswerSections.organisationId, organisationId),
          ),
        );
      await tx
        .update(approvedAnswerSections)
        .set({ sectionId: replacement })
        .where(eq(approvedAnswerSections.id, link.id));
      carriedAnswers.add(link.answerId);
    } else {
      const label =
        loaded.references.get(old.id)?.referenceLabel ?? old.heading ?? 'A linked clause';
      changed.set(link.answerId, [...(changed.get(link.answerId) ?? []), label]);
    }
  }

  let needsReview = 0;
  for (const [answerId, labels] of changed) {
    const reason = `The constitution was updated and ${labels.join(', ')} changed or was removed. Check the answer against the new version and link the clause again.`;
    const updated = await tx
      .update(approvedAnswers)
      .set({
        status: sql`CASE WHEN ${approvedAnswers.status} = 'approved' THEN 'needs_review' ELSE ${approvedAnswers.status} END`,
        approvedAt: sql`CASE WHEN ${approvedAnswers.status} = 'approved' THEN NULL ELSE ${approvedAnswers.approvedAt} END`,
        approvedByUserId: sql`CASE WHEN ${approvedAnswers.status} = 'approved' THEN NULL ELSE ${approvedAnswers.approvedByUserId} END`,
        reviewReason: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(and(eq(approvedAnswers.id, answerId), eq(approvedAnswers.organisationId, organisationId)))
      .returning({ status: approvedAnswers.status });
    if (updated[0]?.status === 'needs_review') needsReview += 1;
  }
  return {
    carried: [...carriedAnswers].filter((id) => !changed.has(id)).length,
    needsReview,
  };
}

function normaliseWording(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

async function loadSections(
  tx: TenantTransaction,
  organisationId: string,
  which: { published: true } | { versionIds: string[] },
): Promise<Loaded> {
  const filter =
    'published' in which
      ? sql`v.status = 'published'`
      : which.versionIds.length > 0
        ? sql`v.id IN (${sql.join(
            which.versionIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`FALSE`;
  const versions = (
    await tx.execute(sql`
      SELECT v.id AS "versionId", v.version_number AS "versionNumber", v.label, v.status,
             v.published_at AS "publishedAt", c.id AS "constitutionId", c.title
      FROM constitution_versions v
      JOIN constitutions c ON c.id = v.constitution_id AND c.organisation_id = v.organisation_id
      WHERE v.organisation_id = ${organisationId} AND ${filter}`)
  ).rows as unknown as VersionRow[];
  if (versions.length === 0) {
    return { versions: new Map(), sections: new Map(), references: new Map() };
  }
  const rows = (
    await tx.execute(sql`
      SELECT s.id, s.version_id AS "versionId", s.parent_section_id AS "parentSectionId",
             s.kind, s.ref_key AS "refKey", s.number, s.heading, s.body, s.position,
             s.source_page AS "sourcePage"
      FROM sections s
      WHERE s.organisation_id = ${organisationId}
        AND s.version_id IN (${sql.join(
          versions.map((version) => sql`${version.versionId}`),
          sql`, `,
        )})
      ORDER BY s.version_id, s.position`)
  ).rows as unknown as SectionRow[];
  return {
    versions: new Map(versions.map((version) => [version.versionId, version])),
    sections: new Map(rows.map((row) => [row.id, row])),
    references: computeReferences(rows),
  };
}

function clauseView(loaded: Loaded, sectionId: string): LinkedClauseView | null {
  const section = loaded.sections.get(sectionId);
  if (!section) return null;
  const version = loaded.versions.get(section.versionId)!;
  const reference = loaded.references.get(section.id);
  const location = (reference?.ancestorIds ?? [])
    .map((id) => loaded.sections.get(id))
    .filter((item): item is SectionRow => item !== undefined)
    .map((item) => [item.number, item.heading].filter(Boolean).join(' · '))
    .join(' › ');
  return {
    sectionId: section.id,
    refKey: section.refKey,
    kind: section.kind,
    number: section.number,
    heading: section.heading,
    reference: reference?.reference ?? null,
    referenceLabel: reference?.referenceLabel ?? null,
    location,
    text: section.body,
    sourcePage: section.sourcePage,
    constitutionId: version.constitutionId,
    constitutionTitle: version.title,
    versionId: version.versionId,
    versionNumber: Number(version.versionNumber),
    versionLabel: version.label,
    versionStatus: version.status,
    publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : null,
    published: version.status === 'published',
  };
}

function unresolvedMessage(unresolved: readonly string[]): string {
  return `Could not find ${unresolved.join(', ')} in the current published constitution (or it appears in more than one document).`;
}

function statusLabel(status: AnswerStatus): string {
  return status === 'needs_review' ? 'waiting for review' : status;
}
