import { Injectable, NotFoundException } from '@nestjs/common';
import {
  constitutionVersions,
  constitutions,
  contentApprovals,
  extractedTexts,
  sections,
} from '@constitution/db';
import { roleHasPermission } from '@constitution/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

/** Reviewers and editors may see drafts; everyone else sees published versions only. */
export function canSeeUnpublished(scope: TenantScope): boolean {
  return roleHasPermission(scope.role, 'content.review');
}

/** Read access to constitutions, versions, sections, extracted text and approvals. */
@Injectable()
export class ConstitutionsService {
  constructor(private readonly tenantDb: TenantDatabase) {}

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

  listSections(scope: TenantScope, versionId: string) {
    return this.tenantDb.run(scope, async (tx) => {
      await this.assertVersionVisible(tx, scope, versionId);
      return tx
        .select({
          id: sections.id,
          parentSectionId: sections.parentSectionId,
          kind: sections.kind,
          refKey: sections.refKey,
          number: sections.number,
          heading: sections.heading,
          body: sections.body,
          position: sections.position,
        })
        .from(sections)
        .where(
          and(eq(sections.versionId, versionId), eq(sections.organisationId, scope.organisationId)),
        )
        .orderBy(asc(sections.position));
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
