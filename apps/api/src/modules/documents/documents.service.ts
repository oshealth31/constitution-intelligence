import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  constitutionVersions,
  constitutions,
  contentApprovals,
  extractedTexts,
  files,
  sections,
  type ConstitutionVersion,
} from '@constitution/db';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { RequestMeta } from '../../common/request-context';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { canSeeUnpublished } from '../constitutions/constitutions.service';
import { StorageService, tenantPrefix } from '../files/storage.service';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import { validateDocument, type ValidatedDocument } from './document-validation';
import { extractDocx } from './docx-extractor';
import {
  DocumentRejectedError,
  type ExtractionIssue,
  type RawExtraction,
} from './extraction-types';
import { extractPdf } from './pdf-extractor';
import { parseStructure, type SectionKind } from './structure-parser';

type VersionStatus = ConstitutionVersion['status'];

export interface SectionChange {
  kind?: SectionKind;
  number?: string | null;
  heading?: string | null;
  body?: string;
}

const NOT_EDITABLE = (status: string) =>
  `This version is ${status.replace('_', ' ')} and can no longer be edited. To make changes, upload or create a new version.`;

/**
 * Constitution documents: upload, text extraction, review and correction, and the version
 * workflow (draft → in review → approved → published, plus archived).
 *
 * Rules:
 * - uploads are private to the organisation and never published automatically;
 * - only drafts can be edited; approved and published versions are fixed (also enforced by
 *   the database);
 * - a version cannot be submitted while flagged sections remain unchecked;
 * - publishing (making a version current) is a separate, explicit step after approval;
 * - every step is recorded in the version history and the audit log.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDatabase,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ----- Constitutions ------------------------------------------------------------------------

  async createConstitution(scope: TenantScope, title: string, meta: RequestMeta) {
    const created = await this.tenantDb.run(scope, async (tx) => {
      const [row] = await tx
        .insert(constitutions)
        .values({ organisationId: scope.organisationId, title })
        .returning({ id: constitutions.id, title: constitutions.title });
      return row!;
    });
    await this.record(scope, 'constitution.created', 'constitution', created.id, meta, {});
    return created;
  }

  // ----- Upload and extraction ----------------------------------------------------------------

  async uploadVersion(
    scope: TenantScope,
    constitutionId: string,
    upload: { fileName: string; label: string | null; content: Buffer },
    meta: RequestMeta,
  ) {
    await this.tenantDb.run(scope, (tx) => this.findConstitution(tx, scope, constitutionId));

    let validated: ValidatedDocument | undefined;
    let raw: RawExtraction | null = null;
    let failure: ExtractionIssue | null = null;
    try {
      validated = validateDocument(upload.fileName, upload.content, this.config.DOCUMENT_MAX_BYTES);
      raw =
        validated.format === 'pdf' ? await extractPdf(upload.content) : extractDocx(upload.content);
    } catch (error) {
      if (error instanceof DocumentRejectedError) {
        await this.audit.record({
          action: 'document.rejected',
          outcome: 'failure',
          actorUserId: scope.userId,
          organisationId: scope.organisationId,
          targetType: 'constitution',
          targetId: constitutionId,
          metadata: { reason: error.code, size: upload.content.length },
          meta,
        });
        throw new BadRequestException(error.message);
      }
      if (!validated) throw error;
      // The file is a valid PDF/DOCX but reading it failed unexpectedly: keep the original and
      // record the failure, so a person can decide what to do.
      failure = {
        code: 'extraction_failed',
        severity: 'error',
        message:
          'The text could not be read from this document because of an unexpected problem. The original is stored safely; please try another copy or contact support.',
      };
    }

    const parsed = raw ? parseStructure(raw.lines) : null;
    const issues: ExtractionIssue[] = [...(raw?.issues ?? []), ...(parsed?.issues ?? [])];
    if (failure) issues.unshift(failure);
    const hasError = issues.some((issue) => issue.severity === 'error');
    const flagged = parsed?.sections.filter((section) => section.needsReview).length ?? 0;
    const extractionStatus = hasError
      ? 'failed'
      : flagged > 0 || issues.length > 0
        ? 'needs_review'
        : 'succeeded';

    // 1. Keep the original document (private, in the organisation's own folder).
    const fileId = randomUUID();
    const storageKey = `${tenantPrefix(scope.organisationId)}documents/${fileId}`;
    await this.storage.put(scope, storageKey, upload.content);

    // 2. Record the file, the new draft version, the extracted text and sections together.
    const versionId = await this.tenantDb.run(scope, async (tx) => {
      // Lock the constitution so two uploads cannot take the same version number.
      await tx.execute(
        sql`SELECT id FROM constitutions WHERE id = ${constitutionId} AND organisation_id = ${scope.organisationId} FOR UPDATE`,
      );
      await tx.insert(files).values({
        id: fileId,
        organisationId: scope.organisationId,
        storageKey,
        originalFilename: validated!.fileName,
        contentType: validated!.contentType,
        sizeBytes: upload.content.length,
        sha256: createHash('sha256').update(upload.content).digest('hex'),
        uploadedByUserId: scope.userId,
        purpose: 'constitution_source',
      });
      const [latest] = await tx
        .select({ versionNumber: constitutionVersions.versionNumber })
        .from(constitutionVersions)
        .where(
          and(
            eq(constitutionVersions.constitutionId, constitutionId),
            eq(constitutionVersions.organisationId, scope.organisationId),
          ),
        )
        .orderBy(desc(constitutionVersions.versionNumber))
        .limit(1);
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const [version] = await tx
        .insert(constitutionVersions)
        .values({
          organisationId: scope.organisationId,
          constitutionId,
          versionNumber,
          label:
            upload.label ??
            `Version ${versionNumber} (uploaded ${validated!.fileName})`.slice(0, 200),
          status: 'draft',
          sourceFileId: fileId,
          createdByUserId: scope.userId,
          extractionStatus,
          extractionIssues: issues,
          extractionMeta: {
            format: validated!.format,
            pageCount: raw?.pageCount ?? null,
            characterCount: parsed?.characterCount ?? 0,
            sectionCount: parsed?.sections.length ?? 0,
            flaggedCount: flagged,
            detectedTitle: parsed?.title ?? null,
          },
        })
        .returning({ id: constitutionVersions.id });
      if (raw) {
        await tx.insert(extractedTexts).values({
          organisationId: scope.organisationId,
          versionId: version!.id,
          fileId,
          content: raw.lines
            .map((line) => (line.autoNumber ? `${line.autoNumber} ${line.text}` : line.text))
            .join('\n'),
        });
      }
      if (parsed && parsed.sections.length > 0) {
        const ids = new Map(parsed.sections.map((section) => [section.key, randomUUID()]));
        await tx.insert(sections).values(
          parsed.sections.map((section, position) => ({
            id: ids.get(section.key)!,
            organisationId: scope.organisationId,
            versionId: version!.id,
            parentSectionId: section.parentKey ? (ids.get(section.parentKey) ?? null) : null,
            kind: section.kind,
            refKey: section.key,
            number: section.number?.slice(0, 40) ?? null,
            heading: section.heading?.slice(0, 500) ?? null,
            body: section.body,
            position,
            needsReview: section.needsReview,
            reviewReason: section.reviewReason?.slice(0, 1000) ?? null,
            sourcePage: section.page,
          })),
        );
      }
      return version!.id;
    });

    await this.record(scope, 'document.uploaded', 'version', versionId, meta, {
      format: validated!.format,
      size: upload.content.length,
      pages: raw?.pageCount ?? null,
    });
    await this.record(scope, 'content.extracted', 'version', versionId, meta, {
      outcome: extractionStatus,
      sections: parsed?.sections.length ?? 0,
      flagged,
    });
    return this.getVersion(scope, versionId);
  }

  // ----- Reading a version for review ---------------------------------------------------------

  async getVersion(scope: TenantScope, versionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      const version = await this.findVersion(tx, scope, versionId);
      const [constitution] = await tx
        .select({ id: constitutions.id, title: constitutions.title })
        .from(constitutions)
        .where(
          and(
            eq(constitutions.id, version.constitutionId),
            eq(constitutions.organisationId, scope.organisationId),
          ),
        );
      const sourceResult = version.sourceFileId
        ? await tx.execute(sql`
            SELECT f.id, f.original_filename AS "fileName", f.content_type AS "contentType",
                   f.size_bytes::int AS "sizeBytes", f.sha256, f.created_at AS "uploadedAt",
                   u.display_name AS "uploadedBy"
            FROM files f LEFT JOIN users u ON u.id = f.uploaded_by_user_id
            WHERE f.id = ${version.sourceFileId} AND f.organisation_id = ${scope.organisationId}`)
        : { rows: [] };
      const sectionRows = await tx
        .select({
          id: sections.id,
          parentSectionId: sections.parentSectionId,
          kind: sections.kind,
          refKey: sections.refKey,
          number: sections.number,
          heading: sections.heading,
          body: sections.body,
          position: sections.position,
          needsReview: sections.needsReview,
          reviewReason: sections.reviewReason,
          sourcePage: sections.sourcePage,
          editedAt: sections.editedAt,
          reviewedAt: sections.reviewedAt,
        })
        .from(sections)
        .where(
          and(eq(sections.versionId, versionId), eq(sections.organisationId, scope.organisationId)),
        )
        .orderBy(asc(sections.position));
      const history = await this.versionEvents(tx, scope, versionId);
      return {
        id: version.id,
        constitution: constitution ?? null,
        versionNumber: version.versionNumber,
        label: version.label,
        status: version.status,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
        extraction: {
          status: version.extractionStatus,
          issues: version.extractionIssues,
          meta: version.extractionMeta,
        },
        source: (sourceResult.rows[0] as Record<string, unknown> | undefined) ?? null,
        sections: sectionRows,
        sectionsNeedingReview: sectionRows.filter((row) => row.needsReview).length,
        history,
        editable: version.status === 'draft',
      };
    });
  }

  /** All versions of a constitution with their history. */
  async constitutionHistory(scope: TenantScope, constitutionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      const constitution = await this.findConstitution(tx, scope, constitutionId);
      const result = await tx.execute(sql`
        SELECT v.id, v.version_number AS "versionNumber", v.label, v.status,
               v.extraction_status AS "extractionStatus", v.published_at AS "publishedAt",
               v.created_at AS "createdAt", u.display_name AS "createdBy",
               f.original_filename AS "fileName",
               (SELECT count(*)::int FROM sections s WHERE s.version_id = v.id
                  AND s.organisation_id = v.organisation_id AND s.needs_review) AS "sectionsNeedingReview"
        FROM constitution_versions v
        LEFT JOIN users u ON u.id = v.created_by_user_id
        LEFT JOIN files f ON f.id = v.source_file_id AND f.organisation_id = v.organisation_id
        WHERE v.constitution_id = ${constitutionId} AND v.organisation_id = ${scope.organisationId}
        ORDER BY v.version_number DESC`);
      const versions = [];
      for (const row of result.rows as Record<string, unknown>[]) {
        versions.push({ ...row, history: await this.versionEvents(tx, scope, String(row.id)) });
      }
      return { ...constitution, versions };
    });
  }

  // ----- Corrections (drafts only) ------------------------------------------------------------

  async updateSection(
    scope: TenantScope,
    versionId: string,
    sectionId: string,
    change: SectionChange,
    meta: RequestMeta,
  ) {
    const refKey = await this.tenantDb.run(scope, async (tx) => {
      await this.assertDraft(tx, scope, versionId);
      const [updated] = await tx
        .update(sections)
        .set({ ...change, editedAt: new Date(), editedByUserId: scope.userId })
        .where(this.sectionMatch(scope, versionId, sectionId))
        .returning({ refKey: sections.refKey });
      if (!updated) throw new NotFoundException('Section not found.');
      return updated.refKey;
    });
    await this.record(scope, 'content.section_edited', 'version', versionId, meta, {
      section: refKey,
      fields: Object.keys(change),
    });
    return this.getVersion(scope, versionId);
  }

  /** A person has compared a flagged section with the original and confirms it is right. */
  async resolveSection(
    scope: TenantScope,
    versionId: string,
    sectionId: string,
    meta: RequestMeta,
  ) {
    const refKey = await this.tenantDb.run(scope, async (tx) => {
      await this.assertDraft(tx, scope, versionId);
      const [updated] = await tx
        .update(sections)
        .set({ needsReview: false, reviewedAt: new Date(), reviewedByUserId: scope.userId })
        .where(this.sectionMatch(scope, versionId, sectionId))
        .returning({ refKey: sections.refKey });
      if (!updated) throw new NotFoundException('Section not found.');
      return updated.refKey;
    });
    await this.record(scope, 'content.flag_resolved', 'version', versionId, meta, {
      section: refKey,
    });
    return this.getVersion(scope, versionId);
  }

  async addSection(
    scope: TenantScope,
    versionId: string,
    input: { afterSectionId: string | null } & Required<Pick<SectionChange, 'kind' | 'body'>> &
      Pick<SectionChange, 'number' | 'heading'>,
    meta: RequestMeta,
  ) {
    const refKey = await this.tenantDb.run(scope, async (tx) => {
      await this.assertDraft(tx, scope, versionId);
      let position = 0;
      let parentSectionId: string | null = null;
      if (input.afterSectionId) {
        const [after] = await tx
          .select({ position: sections.position, parentSectionId: sections.parentSectionId })
          .from(sections)
          .where(this.sectionMatch(scope, versionId, input.afterSectionId));
        if (!after) throw new NotFoundException('Section not found.');
        position = after.position + 1;
        parentSectionId = after.parentSectionId;
      }
      await tx
        .update(sections)
        .set({ position: sql`${sections.position} + 1` })
        .where(
          and(
            eq(sections.versionId, versionId),
            eq(sections.organisationId, scope.organisationId),
            gt(sections.position, position - 1),
          ),
        );
      const refKey = `added-${randomUUID().slice(0, 8)}`;
      await tx.insert(sections).values({
        organisationId: scope.organisationId,
        versionId,
        parentSectionId,
        kind: input.kind,
        refKey,
        number: input.number ?? null,
        heading: input.heading ?? null,
        body: input.body,
        position,
        editedAt: new Date(),
        editedByUserId: scope.userId,
      });
      return refKey;
    });
    await this.record(scope, 'content.section_added', 'version', versionId, meta, {
      section: refKey,
    });
    return this.getVersion(scope, versionId);
  }

  /** Removes a section and anything inside it (drafts only). */
  async removeSection(scope: TenantScope, versionId: string, sectionId: string, meta: RequestMeta) {
    const refKey = await this.tenantDb.run(scope, async (tx) => {
      await this.assertDraft(tx, scope, versionId);
      const [removed] = await tx
        .delete(sections)
        .where(this.sectionMatch(scope, versionId, sectionId))
        .returning({ refKey: sections.refKey });
      if (!removed) throw new NotFoundException('Section not found.');
      return removed.refKey;
    });
    await this.record(scope, 'content.section_removed', 'version', versionId, meta, {
      section: refKey,
    });
    return this.getVersion(scope, versionId);
  }

  // ----- Workflow -----------------------------------------------------------------------------

  /** Draft → in review. The person confirms they compared it with the original document. */
  async submit(scope: TenantScope, versionId: string, comment: string | null, meta: RequestMeta) {
    await this.tenantDb.run(scope, async (tx) => {
      const version = await this.assertDraft(tx, scope, versionId);
      if (version.extractionStatus === 'failed') {
        throw new ConflictException(
          'The text of this document could not be read, so it cannot be submitted. Please upload a readable copy.',
        );
      }
      const [counts] = (
        await tx.execute(sql`
          SELECT count(*)::int AS total, count(*) FILTER (WHERE needs_review)::int AS flagged
          FROM sections WHERE version_id = ${versionId} AND organisation_id = ${scope.organisationId}`)
      ).rows as { total: number; flagged: number }[];
      if (!counts || counts.total === 0) {
        throw new ConflictException('This version has no sections yet.');
      }
      if (counts.flagged > 0) {
        throw new ConflictException(
          `${counts.flagged} section${counts.flagged === 1 ? ' still needs' : 's still need'} checking. Compare ${counts.flagged === 1 ? 'it' : 'them'} with the original document and mark ${counts.flagged === 1 ? 'it' : 'them'} as checked first.`,
        );
      }
      await this.setStatus(tx, scope, versionId, 'in_review');
      await this.addEvent(tx, scope, versionId, 'submitted', comment);
    });
    await this.record(scope, 'version.submitted', 'version', versionId, meta, {});
    return this.getVersion(scope, versionId);
  }

  /** In review → approved (organisation administrators). Approval does NOT publish. */
  async approve(scope: TenantScope, versionId: string, comment: string | null, meta: RequestMeta) {
    await this.transition(scope, versionId, ['in_review'], 'approved', 'approved', comment);
    await this.record(scope, 'version.approved', 'version', versionId, meta, {});
    return this.getVersion(scope, versionId);
  }

  /** In review → back to draft, with the reason. */
  async requestChanges(scope: TenantScope, versionId: string, comment: string, meta: RequestMeta) {
    await this.transition(scope, versionId, ['in_review'], 'draft', 'changes_requested', comment);
    await this.record(scope, 'version.changes_requested', 'version', versionId, meta, {
      reason: comment,
    });
    return this.getVersion(scope, versionId);
  }

  /**
   * Approved → published: this becomes the constitution's current version for members. The
   * previously published version (if any) becomes "superseded"; it is kept unchanged.
   */
  async publish(scope: TenantScope, versionId: string, meta: RequestMeta) {
    const replaced = await this.tenantDb.run(scope, async (tx) => {
      const version = await this.findVersion(tx, scope, versionId, true);
      if (version.status !== 'approved') {
        throw new ConflictException(
          `Only an approved version can be made current. This version is ${version.status.replace('_', ' ')}.`,
        );
      }
      const previous = await tx
        .select({ id: constitutionVersions.id })
        .from(constitutionVersions)
        .where(
          and(
            eq(constitutionVersions.constitutionId, version.constitutionId),
            eq(constitutionVersions.organisationId, scope.organisationId),
            eq(constitutionVersions.status, 'published'),
          ),
        )
        .for('update');
      for (const old of previous) {
        await this.setStatus(tx, scope, old.id, 'superseded');
        await this.addEvent(
          tx,
          scope,
          old.id,
          'superseded',
          `Replaced by version ${version.versionNumber}.`,
        );
      }
      await tx
        .update(constitutionVersions)
        .set({ status: 'published', publishedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(constitutionVersions.id, versionId),
            eq(constitutionVersions.organisationId, scope.organisationId),
          ),
        );
      await this.addEvent(tx, scope, versionId, 'published', null);
      return previous.map((row) => row.id);
    });
    await this.record(scope, 'version.published', 'version', versionId, meta, {
      replaced: replaced.length > 0 ? replaced : null,
    });
    return this.getVersion(scope, versionId);
  }

  /** Withdraws a version that is not the current one. */
  async archive(scope: TenantScope, versionId: string, reason: string, meta: RequestMeta) {
    await this.tenantDb.run(scope, async (tx) => {
      const version = await this.findVersion(tx, scope, versionId, true);
      if (version.status === 'published') {
        throw new ConflictException(
          'The current version cannot be archived. Publish another version first; this one will then be marked as superseded.',
        );
      }
      if (version.status === 'archived') {
        throw new ConflictException('This version is already archived.');
      }
      await this.setStatus(tx, scope, versionId, 'archived');
      await this.addEvent(tx, scope, versionId, 'archived', reason);
    });
    await this.record(scope, 'version.archived', 'version', versionId, meta, { reason });
    return this.getVersion(scope, versionId);
  }

  // ----- The original document ----------------------------------------------------------------

  /**
   * The original uploaded document (the authoritative source). Members may download the
   * original of the published version; reviewers and administrators any version's.
   */
  async readSource(scope: TenantScope, versionId: string) {
    const file = await this.tenantDb.run(scope, async (tx) => {
      const version = await this.findVersion(tx, scope, versionId);
      if (version.status !== 'published' && !canSeeUnpublished(scope)) {
        throw new NotFoundException('Version not found.');
      }
      if (!version.sourceFileId)
        throw new NotFoundException('This version has no original document.');
      const [row] = await tx
        .select()
        .from(files)
        .where(
          and(eq(files.id, version.sourceFileId), eq(files.organisationId, scope.organisationId)),
        );
      if (!row) throw new NotFoundException('This version has no original document.');
      return row;
    });
    const content = await this.storage.get(scope, file.storageKey);
    return { fileName: file.originalFilename, contentType: file.contentType, content };
  }

  // ----- Helpers ------------------------------------------------------------------------------

  private async findConstitution(
    tx: TenantTransaction,
    scope: TenantScope,
    constitutionId: string,
  ) {
    const [constitution] = await tx
      .select({ id: constitutions.id, title: constitutions.title })
      .from(constitutions)
      .where(
        and(
          eq(constitutions.id, constitutionId),
          eq(constitutions.organisationId, scope.organisationId),
        ),
      );
    if (!constitution) throw new NotFoundException('Constitution not found.');
    return constitution;
  }

  private async findVersion(
    tx: TenantTransaction,
    scope: TenantScope,
    versionId: string,
    lock = false,
  ) {
    const query = tx
      .select()
      .from(constitutionVersions)
      .where(
        and(
          eq(constitutionVersions.id, versionId),
          eq(constitutionVersions.organisationId, scope.organisationId),
        ),
      );
    const [version] = lock ? await query.for('update') : await query;
    if (!version) throw new NotFoundException('Version not found.');
    return version;
  }

  private async assertDraft(tx: TenantTransaction, scope: TenantScope, versionId: string) {
    const version = await this.findVersion(tx, scope, versionId, true);
    if (version.status !== 'draft') throw new ConflictException(NOT_EDITABLE(version.status));
    return version;
  }

  private sectionMatch(scope: TenantScope, versionId: string, sectionId: string) {
    return and(
      eq(sections.id, sectionId),
      eq(sections.versionId, versionId),
      eq(sections.organisationId, scope.organisationId),
    );
  }

  private async transition(
    scope: TenantScope,
    versionId: string,
    from: VersionStatus[],
    to: VersionStatus,
    event: 'approved' | 'changes_requested',
    comment: string | null,
  ) {
    await this.tenantDb.run(scope, async (tx) => {
      const version = await this.findVersion(tx, scope, versionId, true);
      if (!from.includes(version.status)) {
        throw new ConflictException(
          `This step is only possible for a version that is ${from.map((status) => status.replace('_', ' ')).join(' or ')}. This version is ${version.status.replace('_', ' ')}.`,
        );
      }
      await this.setStatus(tx, scope, versionId, to);
      await this.addEvent(tx, scope, versionId, event, comment);
    });
  }

  private async setStatus(
    tx: TenantTransaction,
    scope: TenantScope,
    versionId: string,
    status: VersionStatus,
  ) {
    await tx
      .update(constitutionVersions)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(constitutionVersions.id, versionId),
          eq(constitutionVersions.organisationId, scope.organisationId),
        ),
      );
  }

  private async addEvent(
    tx: TenantTransaction,
    scope: TenantScope,
    versionId: string,
    decision: (typeof contentApprovals.$inferInsert)['decision'],
    comment: string | null,
  ) {
    await tx.insert(contentApprovals).values({
      organisationId: scope.organisationId,
      versionId,
      reviewerUserId: scope.userId,
      decision,
      comment,
    });
  }

  private async versionEvents(tx: TenantTransaction, scope: TenantScope, versionId: string) {
    const result = await tx.execute(sql`
      SELECT a.id, a.decision AS "event", a.comment, a.created_at AS "at", u.display_name AS "by"
      FROM content_approvals a LEFT JOIN users u ON u.id = a.reviewer_user_id
      WHERE a.version_id = ${versionId} AND a.organisation_id = ${scope.organisationId}
      ORDER BY a.created_at ASC, a.id ASC`);
    return result.rows as {
      id: string;
      event: string;
      comment: string | null;
      at: string;
      by: string | null;
    }[];
  }

  private record(
    scope: TenantScope,
    action: Parameters<AuditService['record']>[0]['action'],
    targetType: string,
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      outcome: 'success',
      actorUserId: scope.userId,
      organisationId: scope.organisationId,
      targetType,
      targetId,
      metadata,
      meta,
    });
  }
}
