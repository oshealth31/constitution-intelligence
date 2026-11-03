import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { simplifiedSections, users } from '@constitution/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import { AuditService } from '../audit/audit.service';
import { matchesReference, parseReferenceQuery } from '../constitutions/references';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { checkAnswer, hasBlockingIssue, type CheckIssue } from './answer-checks';
import {
  clauseView,
  loadSections,
  normaliseWording,
  type LinkedClauseView,
  type Loaded,
  type SectionRow,
} from './approved-answers.service';

export const SIMPLE_WORDS_DISCLAIMER =
  'Simple words are written and approved by your organisation to help you understand the constitution. They are not legal advice. The original wording is what counts.';

type Row = typeof simplifiedSections.$inferSelect;
export type SimpleStatus = Row['status'];
export type SimpleSource = Row['source'];

/** The simple-words version of one clause, as people managing content see it. */
export interface ManagedSimple {
  id: string;
  text: string;
  status: SimpleStatus;
  source: SimpleSource;
  reviewReason: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  updatedAt: string;
  issues: CheckIssue[];
  readyToApprove: boolean;
}

export interface SimpleOverview {
  constitutions: {
    constitutionId: string;
    title: string;
    versionId: string;
    versionNumber: number;
    versionLabel: string;
    clauses: { clause: LinkedClauseView; simple: ManagedSimple | null }[];
  }[];
}

export interface SimpleImportRow {
  clause: string;
  text: string;
  draftedBy?: 'ai' | 'person';
}

export interface SimpleImportReport {
  saved: { clause: string; sectionId: string }[];
  skipped: { clause: string; reason: string }[];
}

/**
 * Simple words: a plain-language version of each clause, for people who find legal wording
 * hard. Only clauses of the CURRENT PUBLISHED versions can have one. Members see it only once an
 * owner or administrator has approved it, and always under the original wording.
 */
@Injectable()
export class SimpleWordsService {
  constructor(
    private readonly tenantDb: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Every clause of the current published constitutions, with its simple words (if any). */
  overview(scope: TenantScope): Promise<SimpleOverview> {
    return this.tenantDb.run(scope, async (tx) => {
      const loaded = await loadSections(tx, scope.organisationId, { published: true });
      const rows = await this.rowsFor(tx, scope, [...loaded.sections.keys()]);
      const names = await this.names(tx, [...rows.values()]);
      const constitutions: SimpleOverview['constitutions'] = [];
      for (const version of loaded.versions.values()) {
        const clauses = [...loaded.sections.values()]
          .filter((section) => section.versionId === version.versionId)
          .sort((a, b) => a.position - b.position)
          .filter((section) => section.body.trim() !== '')
          .map((section) => {
            const clause = clauseView(loaded, section.id)!;
            const row = rows.get(section.id);
            return { clause, simple: row ? managed(row, clause, names) : null };
          });
        constitutions.push({
          constitutionId: version.constitutionId,
          title: version.title,
          versionId: version.versionId,
          versionNumber: Number(version.versionNumber),
          versionLabel: version.label,
          clauses,
        });
      }
      constitutions.sort((a, b) => a.title.localeCompare(b.title));
      return { constitutions };
    });
  }

  /** Writes (or rewrites) the simple words of a clause. Saving always makes it a draft again. */
  async save(
    scope: TenantScope,
    sectionId: string,
    text: string,
    meta: RequestMeta,
  ): Promise<ManagedSimple> {
    const result = await this.tenantDb.run(scope, async (tx) => {
      const loaded = await loadSections(tx, scope.organisationId, { published: true });
      const section = loaded.sections.get(sectionId);
      if (!section) {
        throw new NotFoundException('Clause not found in the current published constitution.');
      }
      requireText(section);
      return this.upsert(tx, scope, sectionId, text, 'manual');
    });
    await this.record(scope, 'simple_words.saved', sectionId, meta, { wasApproved: result });
    return this.get(scope, sectionId);
  }

  async import(
    scope: TenantScope,
    items: SimpleImportRow[],
    meta: RequestMeta,
  ): Promise<SimpleImportReport> {
    const report = await this.tenantDb.run(scope, async (tx) => {
      const loaded = await loadSections(tx, scope.organisationId, { published: true });
      const existing = await this.rowsFor(tx, scope, [...loaded.sections.keys()]);
      const saved: SimpleImportReport['saved'] = [];
      const skipped: SimpleImportReport['skipped'] = [];
      for (const item of items) {
        const section = resolve(loaded, item.clause);
        if (!section) {
          skipped.push({
            clause: item.clause,
            reason:
              'Not found in the current published constitution (or found in more than one document).',
          });
          continue;
        }
        if (section.body.trim() === '') {
          skipped.push({ clause: item.clause, reason: 'This heading has no text of its own.' });
          continue;
        }
        if (existing.get(section.id)?.status === 'approved') {
          skipped.push({
            clause: item.clause,
            reason: 'Already has approved simple words. Edit them on the page instead.',
          });
          continue;
        }
        await this.upsert(
          tx,
          scope,
          section.id,
          item.text,
          item.draftedBy === 'ai' ? 'ai' : 'import',
        );
        saved.push({ clause: item.clause, sectionId: section.id });
      }
      return { saved, skipped };
    });
    await this.record(scope, 'simple_words.imported', scope.organisationId, meta, {
      saved: report.saved.length,
      skipped: report.skipped.length,
    });
    return report;
  }

  /** Only owners and administrators reach this (checked by the controller). */
  async approve(
    scope: TenantScope,
    sectionId: string,
    confirmed: boolean,
    meta: RequestMeta,
  ): Promise<ManagedSimple> {
    if (!confirmed) {
      throw new BadRequestException(
        'Please confirm that you have read the simple words against the original clause.',
      );
    }
    const facts = await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, sectionId, true);
      if (row.status === 'approved') {
        throw new ConflictException('These simple words are already approved.');
      }
      const view = await this.view(tx, scope, row);
      if (hasBlockingIssue(view.issues)) {
        throw new ConflictException(
          `These simple words cannot be approved yet: ${view.issues
            .filter((issue) => issue.blocking)
            .map((issue) => issue.message)
            .join(' ')}`,
        );
      }
      await tx
        .update(simplifiedSections)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedByUserId: scope.userId,
          reviewReason: null,
          updatedAt: new Date(),
        })
        .where(eq(simplifiedSections.id, row.id));
      return {
        warnings: view.issues.length,
        ownDraft: row.createdByUserId === scope.userId || row.updatedByUserId === scope.userId,
        source: row.source,
      };
    });
    await this.record(scope, 'simple_words.approved', sectionId, meta, facts);
    return this.get(scope, sectionId);
  }

  /** Approved → draft: stops showing it to members. */
  async withdraw(scope: TenantScope, sectionId: string, meta: RequestMeta): Promise<ManagedSimple> {
    await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, sectionId, true);
      if (row.status !== 'approved') {
        throw new ConflictException('Only approved simple words can be withdrawn.');
      }
      await tx
        .update(simplifiedSections)
        .set({
          status: 'draft',
          approvedAt: null,
          approvedByUserId: null,
          updatedByUserId: scope.userId,
          updatedAt: new Date(),
        })
        .where(eq(simplifiedSections.id, row.id));
    });
    await this.record(scope, 'simple_words.withdrawn', sectionId, meta, {});
    return this.get(scope, sectionId);
  }

  async remove(scope: TenantScope, sectionId: string, meta: RequestMeta): Promise<void> {
    await this.tenantDb.run(scope, async (tx) => {
      const row = await this.find(tx, scope, sectionId, true);
      if (row.status === 'approved') {
        throw new ConflictException('Withdraw the approved simple words before deleting them.');
      }
      await tx.delete(simplifiedSections).where(eq(simplifiedSections.id, row.id));
    });
    await this.record(scope, 'simple_words.deleted', sectionId, meta, {});
  }

  get(scope: TenantScope, sectionId: string): Promise<ManagedSimple> {
    return this.tenantDb.run(scope, async (tx) =>
      this.view(tx, scope, await this.find(tx, scope, sectionId)),
    );
  }

  /** Members: approved simple words for the clauses of a PUBLISHED version. */
  forVersion(
    scope: TenantScope,
    versionId: string,
  ): Promise<{ sectionId: string; text: string; approvedAt: string | null }[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const loaded = await loadSections(tx, scope.organisationId, { published: true });
      const sectionIds = [...loaded.sections.values()]
        .filter((section) => section.versionId === versionId)
        .map((section) => section.id);
      if (sectionIds.length === 0) return [];
      const rows = await this.rowsFor(tx, scope, sectionIds);
      return [...rows.values()]
        .filter((row) => row.status === 'approved')
        .map((row) => ({
          sectionId: row.sectionId,
          text: row.text,
          approvedAt: row.approvedAt?.toISOString() ?? null,
        }));
    });
  }

  // ----- Helpers ------------------------------------------------------------------------------

  /** Returns whether an approved version was replaced (it is then a draft again). */
  private async upsert(
    tx: TenantTransaction,
    scope: TenantScope,
    sectionId: string,
    text: string,
    source: SimpleSource,
  ): Promise<boolean> {
    const [existing] = await tx
      .select()
      .from(simplifiedSections)
      .where(
        and(
          eq(simplifiedSections.sectionId, sectionId),
          eq(simplifiedSections.organisationId, scope.organisationId),
        ),
      )
      .for('update');
    if (existing) {
      await tx
        .update(simplifiedSections)
        .set({
          text,
          source: source === 'manual' && existing.source !== 'manual' ? existing.source : source,
          status: 'draft',
          reviewReason: null,
          approvedAt: null,
          approvedByUserId: null,
          updatedByUserId: scope.userId,
          updatedAt: new Date(),
        })
        .where(eq(simplifiedSections.id, existing.id));
      return existing.status === 'approved';
    }
    await tx.insert(simplifiedSections).values({
      organisationId: scope.organisationId,
      sectionId,
      text,
      source,
      createdByUserId: scope.userId,
      updatedByUserId: scope.userId,
    });
    return false;
  }

  private async find(tx: TenantTransaction, scope: TenantScope, sectionId: string, lock = false) {
    const query = tx
      .select()
      .from(simplifiedSections)
      .where(
        and(
          eq(simplifiedSections.sectionId, sectionId),
          eq(simplifiedSections.organisationId, scope.organisationId),
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new NotFoundException('No simple words have been written for this clause.');
    return row;
  }

  private async view(tx: TenantTransaction, scope: TenantScope, row: Row): Promise<ManagedSimple> {
    const versionIds = (await tx.execute(sqlVersionOf(scope.organisationId, row.sectionId)))
      .rows as { versionId: string }[];
    const loaded = await loadSections(tx, scope.organisationId, {
      versionIds: versionIds.map((item) => item.versionId),
    });
    const clause = clauseView(loaded, row.sectionId);
    if (!clause) throw new NotFoundException('Clause not found.');
    return managed(row, clause, await this.names(tx, [row]));
  }

  private async rowsFor(tx: TenantTransaction, scope: TenantScope, sectionIds: string[]) {
    if (sectionIds.length === 0) return new Map<string, Row>();
    const rows = await tx
      .select()
      .from(simplifiedSections)
      .where(
        and(
          eq(simplifiedSections.organisationId, scope.organisationId),
          inArray(simplifiedSections.sectionId, sectionIds),
        ),
      );
    return new Map(rows.map((row) => [row.sectionId, row]));
  }

  private async names(tx: TenantTransaction, rows: Row[]) {
    const wanted = [
      ...new Set(
        rows
          .flatMap((row) => [row.createdByUserId, row.updatedByUserId, row.approvedByUserId])
          .filter((id): id is string => id !== null),
      ),
    ];
    if (wanted.length === 0) return new Map<string, string>();
    const found = await tx
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, wanted));
    return new Map(found.map((item) => [item.id, item.name]));
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
      targetType: 'simplified_section',
      targetId,
      metadata,
      meta,
    });
  }
}

function sqlVersionOf(organisationId: string, sectionId: string) {
  return sql`SELECT version_id AS "versionId" FROM sections
             WHERE organisation_id = ${organisationId} AND id = ${sectionId}`;
}

function requireText(section: SectionRow) {
  if (section.body.trim() === '') {
    throw new BadRequestException(
      'This heading has no text of its own. Write simple words for the clauses under it instead.',
    );
  }
}

function resolve(loaded: Loaded, reference: string): SectionRow | null {
  const query = parseReferenceQuery(reference.trim());
  if (!query) return null;
  const matches = [...loaded.sections.values()].filter((section) =>
    matchesReference(query, section, loaded.references.get(section.id)),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function managed(row: Row, clause: LinkedClauseView, names: Map<string, string>): ManagedSimple {
  // The same mechanical checks as approved answers, against this one clause.
  const issues = checkAnswer(row.text, [{ ...clause, body: clause.text }]);
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    source: row.source,
    reviewReason: row.reviewReason,
    createdBy: name(row.createdByUserId),
    updatedBy: name(row.updatedByUserId),
    approvedBy: name(row.approvedByUserId),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    issues,
    readyToApprove: !hasBlockingIssue(issues),
  };
}

// ----- Shared with document publishing ----------------------------------------------------------

/**
 * Called inside the transaction that publishes a new version. Each clause of the new version that
 * had simple words in the replaced version (same reference) gets a copy:
 *  - wording exactly the same: the copy keeps its status (an approved one stays approved);
 *  - wording changed: the copy is "needs review" (hidden from members) until approved again.
 * The replaced version keeps its own simple words unchanged, for the record.
 */
export async function carryOverSimpleWords(
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
  const oldIds = [...loaded.sections.values()]
    .filter((section) => fromIds.has(section.versionId))
    .map((section) => section.id);
  if (oldIds.length === 0) return { carried: 0, needsReview: 0 };
  const rows = await tx
    .select()
    .from(simplifiedSections)
    .where(
      and(
        eq(simplifiedSections.organisationId, organisationId),
        inArray(simplifiedSections.sectionId, oldIds),
      ),
    );
  if (rows.length === 0) return { carried: 0, needsReview: 0 };

  const identity = (section: SectionRow) =>
    `${section.kind}|${loaded.references.get(section.id)?.reference ?? `#${section.heading ?? ''}`}`;
  const wording = (section: SectionRow) =>
    normaliseWording(`${section.heading ?? ''}\n${section.body}`);
  const newByIdentity = new Map<string, SectionRow>();
  for (const section of loaded.sections.values()) {
    if (section.versionId === toVersionId) newByIdentity.set(identity(section), section);
  }

  let carried = 0;
  let needsReview = 0;
  for (const row of rows) {
    const old = loaded.sections.get(row.sectionId)!;
    const replacement = newByIdentity.get(identity(old));
    if (!replacement || replacement.body.trim() === '') continue;
    const same = wording(replacement) === wording(old);
    const label = loaded.references.get(old.id)?.referenceLabel ?? old.heading ?? 'This clause';
    const inserted = await tx
      .insert(simplifiedSections)
      .values({
        organisationId,
        sectionId: replacement.id,
        text: row.text,
        source: row.source,
        status: same ? row.status : row.status === 'approved' ? 'needs_review' : row.status,
        reviewReason: same
          ? row.reviewReason
          : `The wording of ${label} changed in the new version. Check the simple words against it.`,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        approvedByUserId: same ? row.approvedByUserId : null,
        approvedAt: same ? row.approvedAt : null,
      })
      .onConflictDoNothing()
      .returning({ status: simplifiedSections.status });
    if (inserted.length === 0) continue;
    if (inserted[0]!.status === 'needs_review') needsReview += 1;
    else carried += 1;
  }
  return { carried, needsReview };
}
