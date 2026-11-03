import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { usageRecords } from '@constitution/db';
import { sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/config';
import { APP_CONFIG } from '../../config/config.module';
import { computeReferences } from '../constitutions/references';
import type { Access } from '../subscriptions/access';
import { TenantDatabase, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

/** Bump when the shape of the bundle changes, so old copies on devices are replaced. */
export const OFFLINE_FORMAT = 1;

interface VersionRow {
  constitutionId: string;
  title: string;
  versionId: string;
  versionNumber: number;
  label: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
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

/**
 * The content a member's device may keep for offline reading: ONLY the current published
 * (approved) version of each constitution, with its approved simple words when the plan includes
 * them, the organisation's name and colours, and dates. Deliberately left out: drafts, other
 * versions, member lists, names, e-mail addresses, questions and answers, billing, audit data,
 * and anything about the signed-in person apart from their user id (to tie the copy to them).
 */
@Injectable()
export class OfflineService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDatabase,
  ) {}

  /** Cheap check: has anything in the offline copy changed? */
  status(scope: TenantScope, access: Access | undefined) {
    return this.tenantDb.run(scope, async (tx) => {
      const versions = await this.publishedVersions(tx, scope);
      const simple = await this.simpleWordsStamp(tx, scope, versions, access);
      const now = new Date();
      return {
        format: OFFLINE_FORMAT,
        contentHash: hashOf(versions, simple),
        checkedAt: now.toISOString(),
        // A successful check confirms the saved copy is current, so it may be shown for longer.
        usableUntil: new Date(
          now.getTime() + this.config.OFFLINE_COPY_MAX_AGE_DAYS * 86_400_000,
        ).toISOString(),
      };
    });
  }

  bundle(scope: TenantScope, access: Access | undefined) {
    return this.tenantDb.run(scope, async (tx) => {
      const now = new Date();
      const versions = await this.publishedVersions(tx, scope);
      const [organisation] = (
        await tx.execute(sql`
          SELECT o.id, o.slug, coalesce(b.display_name, o.name) AS name,
                 b.primary_colour AS "primaryColour", b.accent_colour AS "accentColour",
                 b.secondary_colour AS "secondaryColour"
          FROM organisations o
          LEFT JOIN organisation_branding b ON b.organisation_id = o.id
          WHERE o.id = ${scope.organisationId}`)
      ).rows as {
        id: string;
        slug: string;
        name: string;
        primaryColour: string | null;
        accentColour: string | null;
        secondaryColour: string | null;
      }[];
      const sectionRows =
        versions.length === 0
          ? []
          : ((
              await tx.execute(sql`
                SELECT s.id, s.version_id AS "versionId", s.parent_section_id AS "parentSectionId",
                       s.kind, s.ref_key AS "refKey", s.number, s.heading, s.body, s.position,
                       s.source_page AS "sourcePage"
                FROM sections s
                WHERE s.organisation_id = ${scope.organisationId}
                  AND s.version_id IN (${sql.join(
                    versions.map((version) => sql`${version.versionId}`),
                    sql`, `,
                  )})
                ORDER BY s.version_id, s.position`)
            ).rows as unknown as SectionRow[]);
      const references = computeReferences(sectionRows);
      const includeSimple = access?.features.includes('simple_words') ?? false;
      const simpleRows =
        includeSimple && sectionRows.length > 0
          ? ((
              await tx.execute(sql`
                SELECT section_id AS "sectionId", text
                FROM simplified_sections
                WHERE organisation_id = ${scope.organisationId} AND status = 'approved'
                  AND section_id IN (${sql.join(
                    sectionRows.map((section) => sql`${section.id}`),
                    sql`, `,
                  )})`)
            ).rows as { sectionId: string; text: string }[])
          : [];
      const simpleBySection = new Map(simpleRows.map((row) => [row.sectionId, row.text]));
      const simpleStamp = await this.simpleWordsStamp(tx, scope, versions, access);

      await tx.insert(usageRecords).values({
        organisationId: scope.organisationId,
        metric: 'offline.downloads',
        quantity: 1,
        userId: scope.userId,
      });

      return {
        format: OFFLINE_FORMAT,
        contentHash: hashOf(versions, simpleStamp),
        generatedAt: now.toISOString(),
        // The device stops showing this copy after this date unless it has synced again.
        usableUntil: new Date(
          now.getTime() + this.config.OFFLINE_COPY_MAX_AGE_DAYS * 86_400_000,
        ).toISOString(),
        userId: scope.userId,
        organisation: {
          id: organisation!.id,
          slug: organisation!.slug,
          name: organisation!.name,
          colours: {
            primary: organisation!.primaryColour,
            accent: organisation!.accentColour,
            secondary: organisation!.secondaryColour,
          },
        },
        simpleWordsDisclaimer: includeSimple
          ? 'Simple words are written and approved by your organisation to help you understand the constitution. They are not legal advice. The original wording is what counts.'
          : null,
        constitutions: versions.map((version) => ({
          id: version.constitutionId,
          title: version.title,
          version: {
            id: version.versionId,
            versionNumber: Number(version.versionNumber),
            label: version.label,
            publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : null,
          },
          sections: sectionRows
            .filter((section) => section.versionId === version.versionId)
            .map((section) => ({
              id: section.id,
              parentSectionId: section.parentSectionId,
              kind: section.kind,
              refKey: section.refKey,
              number: section.number,
              heading: section.heading,
              body: section.body,
              position: section.position,
              sourcePage: section.sourcePage,
              reference: references.get(section.id)?.reference ?? null,
              referenceLabel: references.get(section.id)?.referenceLabel ?? null,
              simpleWords: simpleBySection.get(section.id) ?? null,
            })),
        })),
      };
    });
  }

  private async publishedVersions(tx: TenantTransaction, scope: TenantScope) {
    return (
      await tx.execute(sql`
        SELECT c.id AS "constitutionId", c.title, v.id AS "versionId",
               v.version_number AS "versionNumber", v.label, v.published_at AS "publishedAt",
               v.updated_at AS "updatedAt"
        FROM constitution_versions v
        JOIN constitutions c ON c.id = v.constitution_id AND c.organisation_id = v.organisation_id
        WHERE v.organisation_id = ${scope.organisationId} AND v.status = 'published'
        ORDER BY c.title`)
    ).rows as unknown as VersionRow[];
  }

  /** Changes whenever approved simple words for the published versions change. */
  private async simpleWordsStamp(
    tx: TenantTransaction,
    scope: TenantScope,
    versions: VersionRow[],
    access: Access | undefined,
  ): Promise<string> {
    if (!access?.features.includes('simple_words') || versions.length === 0) return 'none';
    const [row] = (
      await tx.execute(sql`
        SELECT count(*)::int AS count, max(ss.updated_at) AS latest
        FROM simplified_sections ss
        JOIN sections s ON s.id = ss.section_id AND s.organisation_id = ss.organisation_id
        WHERE ss.organisation_id = ${scope.organisationId} AND ss.status = 'approved'
          AND s.version_id IN (${sql.join(
            versions.map((version) => sql`${version.versionId}`),
            sql`, `,
          )})`)
    ).rows as { count: number; latest: Date | string | null }[];
    return `${row?.count ?? 0}:${row?.latest ? new Date(row.latest).toISOString() : '-'}`;
  }
}

function hashOf(versions: VersionRow[], simple: string): string {
  const text = [
    `format:${OFFLINE_FORMAT}`,
    ...versions.map(
      (version) =>
        `${version.constitutionId}:${version.versionId}:${new Date(version.updatedAt).toISOString()}:${version.title}`,
    ),
    `simple:${simple}`,
  ].join('|');
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}
