import { Injectable, NotFoundException } from '@nestjs/common';
import {
  constitutionVersions,
  constitutions,
  contentApprovals,
  extractedTexts,
  sections,
} from '@constitution/db';
import { roleHasPermission } from '@constitution/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import { computeReferences } from './references';
import type { TenantScope } from '../tenancy/tenant-scope';

/** Reviewers and editors may see drafts; everyone else sees published versions only. */
export function canSeeUnpublished(scope: TenantScope): boolean {
  return roleHasPermission(scope.role, 'content.review');
}

export interface LibraryItem {
  id: string;
  title: string;
  published: {
    versionId: string;
    label: string;
    versionNumber: number;
    publishedAt: string | null;
    sectionCount: number;
  } | null;
  /** Drafts, versions in review and approved-but-unpublished versions. Reviewers only. */
  versionsInProgress?: number;
}

export interface ContentStatusVersion {
  id: string;
  versionNumber: number;
  label: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  sectionCount: number;
  extractionStatus: string;
  sectionsNeedingReview: number;
  fileName: string | null;
  latestDecision: {
    decision: 'approved' | 'changes_requested';
    comment: string | null;
    reviewerName: string | null;
    createdAt: string;
  } | null;
}

/** Read access to constitutions, versions, sections, extracted text and approvals. */
@Injectable()
export class ConstitutionsService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  /**
   * The organisation's constitution library. Members see only constitutions that have a
   * published version; reviewers also see work in progress.
   */
  library(scope: TenantScope): Promise<LibraryItem[]> {
    const reviewer = canSeeUnpublished(scope);
    return this.tenantDb.run(scope, async (tx) => {
      const result = await tx.execute(sql`
        SELECT c.id, c.title,
               v.id AS "versionId", v.label, v.version_number AS "versionNumber",
               v.published_at AS "publishedAt",
               (SELECT count(*)::int FROM sections s
                 WHERE s.version_id = v.id AND s.organisation_id = c.organisation_id) AS "sectionCount",
               (SELECT count(*)::int FROM constitution_versions w
                 WHERE w.constitution_id = c.id AND w.organisation_id = c.organisation_id
                   AND w.status IN ('draft', 'in_review', 'approved')) AS "versionsInProgress"
        FROM constitutions c
        LEFT JOIN constitution_versions v
          ON v.constitution_id = c.id AND v.organisation_id = c.organisation_id
         AND v.status = 'published'
        WHERE c.organisation_id = ${scope.organisationId}
        ORDER BY c.title ASC
      `);
      type Row = {
        id: string;
        title: string;
        versionId: string | null;
        label: string | null;
        versionNumber: number | null;
        publishedAt: Date | string | null;
        sectionCount: number;
        versionsInProgress: number;
      };
      return (result.rows as unknown as Row[])
        .filter((row) => reviewer || row.versionId !== null)
        .map((row) => ({
          id: row.id,
          title: row.title,
          published: row.versionId
            ? {
                versionId: row.versionId,
                label: row.label ?? '',
                versionNumber: Number(row.versionNumber),
                publishedAt: toIso(row.publishedAt),
                sectionCount: Number(row.sectionCount),
              }
            : null,
          ...(reviewer ? { versionsInProgress: Number(row.versionsInProgress) } : {}),
        }));
    });
  }

  /** One constitution and the versions the caller may read (404 if they may read none). */
  getConstitution(scope: TenantScope, constitutionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      const [constitution] = await tx
        .select({ id: constitutions.id, title: constitutions.title })
        .from(constitutions)
        .where(
          and(
            eq(constitutions.id, constitutionId),
            eq(constitutions.organisationId, scope.organisationId),
          ),
        )
        .limit(1);
      if (!constitution) {
        throw new NotFoundException('Constitution not found.');
      }
      const conditions = [
        eq(constitutionVersions.constitutionId, constitutionId),
        eq(constitutionVersions.organisationId, scope.organisationId),
      ];
      if (!canSeeUnpublished(scope)) {
        conditions.push(eq(constitutionVersions.status, 'published'));
      }
      const versions = await tx
        .select({
          id: constitutionVersions.id,
          versionNumber: constitutionVersions.versionNumber,
          label: constitutionVersions.label,
          status: constitutionVersions.status,
          publishedAt: constitutionVersions.publishedAt,
          hasOriginal: sql<boolean>`${constitutionVersions.sourceFileId} IS NOT NULL`,
        })
        .from(constitutionVersions)
        .where(and(...conditions))
        .orderBy(desc(constitutionVersions.versionNumber));
      if (versions.length === 0 && !canSeeUnpublished(scope)) {
        // Members cannot learn about constitutions that have nothing published.
        throw new NotFoundException('Constitution not found.');
      }
      return { ...constitution, versions };
    });
  }

  /** Every version of every constitution with its approval state. For reviewers and admins. */
  contentStatus(scope: TenantScope) {
    return this.tenantDb.run(scope, async (tx) => {
      const result = await tx.execute(sql`
        SELECT c.id AS "constitutionId", c.title,
               v.id, v.version_number AS "versionNumber", v.label, v.status,
               v.published_at AS "publishedAt", v.updated_at AS "updatedAt",
               (SELECT count(*)::int FROM sections s
                 WHERE s.version_id = v.id AND s.organisation_id = v.organisation_id) AS "sectionCount",
               (SELECT count(*)::int FROM sections s
                 WHERE s.version_id = v.id AND s.organisation_id = v.organisation_id
                   AND s.needs_review) AS "sectionsNeedingReview",
               v.extraction_status AS "extractionStatus", f.original_filename AS "fileName",
               a.decision, a.comment, a.created_at AS "decidedAt", u.display_name AS "reviewerName"
        FROM constitutions c
        LEFT JOIN constitution_versions v
          ON v.constitution_id = c.id AND v.organisation_id = c.organisation_id
        LEFT JOIN LATERAL (
          SELECT ca.decision, ca.comment, ca.created_at, ca.reviewer_user_id
          FROM content_approvals ca
          WHERE ca.version_id = v.id AND ca.organisation_id = v.organisation_id
            AND ca.decision IN ('approved', 'changes_requested')
          ORDER BY ca.created_at DESC
          LIMIT 1
        ) a ON true
        LEFT JOIN users u ON u.id = a.reviewer_user_id
        LEFT JOIN files f ON f.id = v.source_file_id AND f.organisation_id = v.organisation_id
        WHERE c.organisation_id = ${scope.organisationId}
        ORDER BY c.title ASC, v.version_number DESC NULLS LAST
      `);
      type Row = {
        constitutionId: string;
        title: string;
        id: string;
        versionNumber: number;
        label: string;
        status: string;
        publishedAt: Date | string | null;
        updatedAt: Date | string;
        sectionCount: number;
        sectionsNeedingReview: number;
        extractionStatus: string;
        fileName: string | null;
        decision: 'approved' | 'changes_requested' | null;
        comment: string | null;
        decidedAt: Date | string | null;
        reviewerName: string | null;
      };
      const grouped = new Map<
        string,
        { id: string; title: string; versions: ContentStatusVersion[] }
      >();
      for (const row of result.rows as unknown as Row[]) {
        const entry = grouped.get(row.constitutionId) ?? {
          id: row.constitutionId,
          title: row.title,
          versions: [],
        };
        grouped.set(row.constitutionId, entry);
        if (!row.id) continue; // a constitution with no versions yet
        entry.versions.push({
          id: row.id,
          versionNumber: Number(row.versionNumber),
          label: row.label,
          status: row.status,
          publishedAt: toIso(row.publishedAt),
          updatedAt: toIso(row.updatedAt) ?? '',
          sectionCount: Number(row.sectionCount),
          extractionStatus: row.extractionStatus,
          sectionsNeedingReview: Number(row.sectionsNeedingReview),
          fileName: row.fileName,
          latestDecision: row.decision
            ? {
                decision: row.decision,
                comment: row.comment,
                reviewerName: row.reviewerName,
                createdAt: toIso(row.decidedAt) ?? '',
              }
            : null,
        });
        grouped.set(row.constitutionId, entry);
      }
      return [...grouped.values()];
    });
  }

  listConstitutions(scope: TenantScope) {
    return this.tenantDb.run(scope, (tx) =>
      tx
        .select({
          id: constitutions.id,
          title: constitutions.title,
          createdAt: constitutions.createdAt,
        })
        .from(constitutions)
        .where(eq(constitutions.organisationId, scope.organisationId))
        .orderBy(asc(constitutions.title)),
    );
  }

  listVersions(scope: TenantScope, constitutionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      const [constitution] = await tx
        .select({ id: constitutions.id })
        .from(constitutions)
        .where(
          and(
            eq(constitutions.id, constitutionId),
            eq(constitutions.organisationId, scope.organisationId),
          ),
        )
        .limit(1);
      if (!constitution) {
        throw new NotFoundException('Constitution not found.');
      }
      const conditions = [
        eq(constitutionVersions.constitutionId, constitutionId),
        eq(constitutionVersions.organisationId, scope.organisationId),
      ];
      if (!canSeeUnpublished(scope)) {
        conditions.push(eq(constitutionVersions.status, 'published'));
      }
      return tx
        .select({
          id: constitutionVersions.id,
          versionNumber: constitutionVersions.versionNumber,
          label: constitutionVersions.label,
          status: constitutionVersions.status,
          publishedAt: constitutionVersions.publishedAt,
        })
        .from(constitutionVersions)
        .where(and(...conditions))
        .orderBy(desc(constitutionVersions.versionNumber));
    });
  }

  /**
   * The sections of a version in reading order, with references ("Clause 7(a)") worked out
   * from the stored numbers only. Wording is returned exactly as stored.
   */
  listSections(scope: TenantScope, versionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      await this.assertVersionVisible(tx, scope, versionId);
      const rows = await tx
        .select({
          id: sections.id,
          parentSectionId: sections.parentSectionId,
          kind: sections.kind,
          refKey: sections.refKey,
          number: sections.number,
          heading: sections.heading,
          body: sections.body,
          position: sections.position,
          sourcePage: sections.sourcePage,
        })
        .from(sections)
        .where(
          and(eq(sections.versionId, versionId), eq(sections.organisationId, scope.organisationId)),
        )
        .orderBy(asc(sections.position));
      const references = computeReferences(rows);
      return rows.map((row) => ({
        ...row,
        reference: references.get(row.id)?.reference ?? null,
        referenceLabel: references.get(row.id)?.referenceLabel ?? null,
      }));
    });
  }

  getExtractedText(scope: TenantScope, versionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      await this.assertVersionVisible(tx, scope, versionId);
      return tx
        .select({
          id: extractedTexts.id,
          content: extractedTexts.content,
          extractedAt: extractedTexts.extractedAt,
        })
        .from(extractedTexts)
        .where(
          and(
            eq(extractedTexts.versionId, versionId),
            eq(extractedTexts.organisationId, scope.organisationId),
          ),
        );
    });
  }

  listApprovals(scope: TenantScope, versionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      await this.assertVersionVisible(tx, scope, versionId);
      return tx
        .select({
          id: contentApprovals.id,
          decision: contentApprovals.decision,
          comment: contentApprovals.comment,
          reviewerUserId: contentApprovals.reviewerUserId,
          createdAt: contentApprovals.createdAt,
        })
        .from(contentApprovals)
        .where(
          and(
            eq(contentApprovals.versionId, versionId),
            eq(contentApprovals.organisationId, scope.organisationId),
          ),
        )
        .orderBy(desc(contentApprovals.createdAt));
    });
  }

  /** 404 unless the version is in the caller's organisation (and published, for non-reviewers). */
  private async assertVersionVisible(
    tx: TenantTransaction,
    scope: TenantScope,
    versionId: string,
  ): Promise<void> {
    const [version] = await tx
      .select({ status: constitutionVersions.status })
      .from(constitutionVersions)
      .where(
        and(
          eq(constitutionVersions.id, versionId),
          eq(constitutionVersions.organisationId, scope.organisationId),
        ),
      )
      .limit(1);
    if (!version || (version.status !== 'published' && !canSeeUnpublished(scope))) {
      throw new NotFoundException('Version not found.');
    }
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
