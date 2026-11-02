import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';

export interface SectionMatch {
  sectionId: string;
  versionId: string;
  constitutionId: string;
  constitutionTitle: string;
  refKey: string;
  number: string | null;
  heading: string | null;
  snippet: string;
  rank: number;
}

/**
 * Keyword search over PUBLISHED constitution sections of the caller's organisation only.
 * Isolation: runs under Row-Level Security AND filters by organisation_id explicitly.
 * Also used as the retrieval step for AI answers (see AiService).
 */
@Injectable()
export class SearchService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  search(scope: TenantScope, query: string, limit = 20): Promise<SectionMatch[]> {
    return this.tenantDb.run(scope, async (tx) => {
      const result = await tx.execute(sql`
        SELECT s.id AS "sectionId",
               s.version_id AS "versionId",
               c.id AS "constitutionId",
               c.title AS "constitutionTitle",
               s.ref_key AS "refKey",
               s.number,
               s.heading,
               ts_headline('simple', s.body, q, 'StartSel=[[, StopSel=]], MaxWords=35, MinWords=10') AS snippet,
               ts_rank(s.search_vector, q) AS rank
        FROM sections s
        JOIN constitution_versions v
          ON v.id = s.version_id AND v.organisation_id = s.organisation_id
        JOIN constitutions c
          ON c.id = v.constitution_id AND c.organisation_id = v.organisation_id
        CROSS JOIN websearch_to_tsquery('simple', ${query}) AS q
        WHERE s.organisation_id = ${scope.organisationId}
          AND v.status = 'published'
          AND s.search_vector @@ q
        ORDER BY rank DESC, s.position ASC
        LIMIT ${limit}
      `);
      return (result.rows as unknown as SectionMatch[]).map((row) => ({
        ...row,
        rank: Number(row.rank),
      }));
    });
  }
}
