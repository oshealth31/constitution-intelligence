import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import {
  computeReferences,
  excerpt,
  matchesReference,
  parseReferenceQuery,
  searchTerms,
  type ReferenceNode,
} from './references';

export type MatchedBy = 'reference' | 'title' | 'text';

export interface ReaderSearchResult {
  sectionId: string;
  refKey: string;
  kind: string;
  /** Number and heading exactly as stored. */
  number: string | null;
  heading: string | null;
  /** Worked out from stored numbers only, e.g. "7(a)" and "Clause 7(a)". */
  reference: string | null;
  referenceLabel: string | null;
  /** The parts/clauses this section sits in, outermost first. */
  path: { refKey: string; number: string | null; heading: string | null }[];
  /** A verbatim slice of the original wording ("…" marks left-out text). */
  excerpt: string;
  matchedBy: MatchedBy;
  sourcePage: number | null;
  constitutionId: string;
  constitutionTitle: string;
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  publishedAt: string | null;
}

export interface ReaderSearchResponse {
  query: string;
  /** Set when the query was read as a clause or part reference. */
  interpretedAs: { type: 'clause' | 'part' | 'chapter'; display: string } | null;
  terms: string[];
  results: ReaderSearchResult[];
  /** Headings that look similar, offered when nothing was found. */
  suggestions: string[];
}

interface VersionRow {
  versionId: string;
  versionNumber: number;
  label: string;
  publishedAt: Date | string | null;
  constitutionId: string;
  title: string;
}

interface SectionRow extends ReferenceNode {
  versionId: string;
  refKey: string;
  body: string;
  sourcePage: number | null;
}

const MAX_RESULTS = 30;

/**
 * Search for the constitution reader: by clause number, by section title and by keyword.
 *
 * Only PUBLISHED (approved and current) versions of the caller's own organisation are ever
 * searched, whatever the caller's role: runs under Row-Level Security and filters by
 * organisation explicitly. Results show stored wording and numbers only; nothing is generated.
 */
@Injectable()
export class ReaderSearchService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  find(scope: TenantScope, query: string, constitutionId?: string): Promise<ReaderSearchResponse> {
    const referenceQuery = parseReferenceQuery(query);
    const terms = searchTerms(query);
    return this.tenantDb.run(scope, async (tx) => {
      if (constitutionId) {
        const found = await tx.execute(
          sql`SELECT 1 FROM constitutions WHERE id = ${constitutionId} AND organisation_id = ${scope.organisationId}`,
        );
        if (found.rows.length === 0) throw new NotFoundException('Constitution not found.');
      }

      const versions = (
        await tx.execute(sql`
          SELECT v.id AS "versionId", v.version_number AS "versionNumber", v.label,
                 v.published_at AS "publishedAt", c.id AS "constitutionId", c.title
          FROM constitution_versions v
          JOIN constitutions c ON c.id = v.constitution_id AND c.organisation_id = v.organisation_id
          WHERE v.organisation_id = ${scope.organisationId}
            AND v.status = 'published'
            ${constitutionId ? sql`AND c.id = ${constitutionId}` : sql``}`)
      ).rows as unknown as VersionRow[];
      const empty: ReaderSearchResponse = {
        query,
        interpretedAs: interpreted(referenceQuery),
        terms,
        results: [],
        suggestions: [],
      };
      if (versions.length === 0) return empty;
      const versionIds = versions.map((version) => version.versionId);
      const versionById = new Map(versions.map((version) => [version.versionId, version]));

      const sections = (
        await tx.execute(sql`
          SELECT s.id, s.version_id AS "versionId", s.parent_section_id AS "parentSectionId",
                 s.kind, s.ref_key AS "refKey", s.number, s.heading, s.body, s.position,
                 s.source_page AS "sourcePage"
          FROM sections s
          WHERE s.organisation_id = ${scope.organisationId}
            AND s.version_id IN (${sql.join(
              versionIds.map((id) => sql`${id}`),
              sql`, `,
            )})
          ORDER BY s.version_id, s.position`)
      ).rows as unknown as SectionRow[];
      const byId = new Map(sections.map((section) => [section.id, section]));
      const references = computeReferences(sections);

      const ordered: { section: SectionRow; matchedBy: MatchedBy }[] = [];
      const add = (section: SectionRow, matchedBy: MatchedBy) => {
        if (!ordered.some((item) => item.section.id === section.id))
          ordered.push({ section, matchedBy });
      };

      // 1. Clause or part number.
      if (referenceQuery) {
        for (const section of sections) {
          if (matchesReference(referenceQuery, section, references.get(section.id)))
            add(section, 'reference');
        }
      }
      // 2. Section titles: exact title first, then titles containing the query.
      const needle = query.trim().toLowerCase();
      for (const section of sections) {
        if (section.heading?.trim().toLowerCase() === needle) add(section, 'title');
      }
      for (const section of sections) {
        if (needle.length >= 3 && section.heading?.toLowerCase().includes(needle))
          add(section, 'title');
      }
      // 3. Keywords anywhere in the number, heading or text.
      const keyword = (
        await tx.execute(sql`
          SELECT s.id, ts_rank(s.search_vector, q) AS rank
          FROM sections s
          CROSS JOIN websearch_to_tsquery('simple', ${query}) AS q
          WHERE s.organisation_id = ${scope.organisationId}
            AND s.version_id IN (${sql.join(
              versionIds.map((id) => sql`${id}`),
              sql`, `,
            )})
            AND s.search_vector @@ q
          ORDER BY rank DESC, s.position ASC
          LIMIT 100`)
      ).rows as { id: string }[];
      for (const row of keyword) {
        const section = byId.get(row.id);
        if (section) add(section, 'text');
      }

      const results = ordered
        .slice(0, MAX_RESULTS)
        .map(({ section, matchedBy }): ReaderSearchResult => {
          const reference = references.get(section.id);
          const version = versionById.get(section.versionId)!;
          return {
            sectionId: section.id,
            refKey: section.refKey,
            kind: section.kind,
            number: section.number,
            heading: section.heading,
            reference: reference?.reference ?? null,
            referenceLabel: reference?.referenceLabel ?? null,
            path: (reference?.ancestorIds ?? [])
              .map((id) => byId.get(id))
              .filter((item): item is SectionRow => item !== undefined)
              .map((item) => ({ refKey: item.refKey, number: item.number, heading: item.heading })),
            excerpt: excerpt(section.body, terms),
            matchedBy,
            sourcePage: section.sourcePage,
            constitutionId: version.constitutionId,
            constitutionTitle: version.title,
            versionId: version.versionId,
            versionNumber: Number(version.versionNumber),
            versionLabel: version.label,
            publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : null,
          };
        });

      let suggestions: string[] = [];
      if (results.length === 0 && !referenceQuery && needle.length >= 3) {
        // Similar-looking headings (for spelling mistakes), from the same published text only.
        suggestions = (
          (
            await tx.execute(sql`
              SELECT s.heading, max(greatest(similarity(lower(s.heading), ${needle}),
                                              word_similarity(${needle}, lower(s.heading)))) AS score
              FROM sections s
              WHERE s.organisation_id = ${scope.organisationId}
                AND s.version_id IN (${sql.join(
                  versionIds.map((id) => sql`${id}`),
                  sql`, `,
                )})
                AND s.heading IS NOT NULL
              GROUP BY s.heading
              HAVING max(greatest(similarity(lower(s.heading), ${needle}),
                                  word_similarity(${needle}, lower(s.heading)))) > 0.3
              ORDER BY score DESC
              LIMIT 5`)
          ).rows as { heading: string }[]
        ).map((row) => row.heading);
      }
      return { ...empty, results, suggestions };
    });
  }
}

function interpreted(
  query: ReturnType<typeof parseReferenceQuery>,
): ReaderSearchResponse['interpretedAs'] {
  if (!query) return null;
  return query.type === 'division'
    ? { type: query.kind, display: query.display }
    : { type: 'clause', display: query.display };
}
