import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  computeReferences,
  parseReferenceQuery,
  type ReferenceNode,
} from '../constitutions/references';
import { TenantDatabase } from '../tenancy/tenant-database.service';
import type { TenantScope } from '../tenancy/tenant-scope';
import type { Passage } from './ai-prompt';

/**
 * Finds the passages an answer may use: ONLY sections of the PUBLISHED (approved, current)
 * versions of the caller's own organisation. Runs under Row-Level Security and filters by
 * organisation explicitly. Drafts, versions in review, approved-but-unpublished, superseded and
 * archived versions, and every other organisation's documents, are never read.
 */

const STOP_WORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below
  between both but by can could did do does doing down during each few for from further had has have
  having he her here hers herself him himself his how i if in into is it its itself just let me more
  most my myself no nor not now of off on once only or other ought our ours ourselves out over own
  please same she should so some such tell than that the their theirs them themselves then there these
  they this those through to too under until up very was we were what when where which while who whom
  why will with would you your yours yourself yourselves constitution organisation organization say
  says said explain mean means rule rules allowed allow`
    .split(/\s+/)
    .filter(Boolean),
);

export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    if (word.length < 2 || STOP_WORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
  }
  return terms.slice(0, 12);
}

/** Clause or part references written in a question ("what does clause 7(a) say?"). */
export function questionReferences(question: string) {
  const found = [];
  const pattern =
    /\b(clause|section|article|rule|paragraph|part|chapter)s?\s+(\d{1,3}(?:\.\d{1,3})*(?:\s*\([a-z]{1,4}\))*|[ivxlc]{1,7}\b|one|two|three|four|five|six|seven|eight|nine|ten)/gi;
  for (const match of question.matchAll(pattern)) {
    const word = match[1]!.toLowerCase();
    const parsed = parseReferenceQuery(
      `${word === 'part' || word === 'chapter' ? word : 'clause'} ${match[2]}`,
    );
    if (parsed) found.push(parsed);
  }
  return found;
}

interface SectionRow extends ReferenceNode {
  versionId: string;
  refKey: string;
  body: string;
  sourcePage: number | null;
}

interface VersionRow {
  versionId: string;
  versionNumber: number;
  label: string;
  publishedAt: Date | string | null;
  constitutionId: string;
  title: string;
}

const MAX_PASSAGES = 8;
const MAX_CHARACTERS = 14_000;

@Injectable()
export class AiRetrievalService {
  constructor(private readonly tenantDb: TenantDatabase) {}

  /** Up to 8 passages, best first. An empty list means "nothing relevant": do not call the AI. */
  retrieve(scope: TenantScope, question: string): Promise<Passage[]> {
    const terms = questionTerms(question);
    const references = questionReferences(question);
    if (terms.length === 0 && references.length === 0) return Promise.resolve([]);

    return this.tenantDb.run(scope, async (tx) => {
      const versions = (
        await tx.execute(sql`
          SELECT v.id AS "versionId", v.version_number AS "versionNumber", v.label,
                 v.published_at AS "publishedAt", c.id AS "constitutionId", c.title
          FROM constitution_versions v
          JOIN constitutions c ON c.id = v.constitution_id AND c.organisation_id = v.organisation_id
          WHERE v.organisation_id = ${scope.organisationId} AND v.status = 'published'`)
      ).rows as unknown as VersionRow[];
      if (versions.length === 0) return [];
      const versionIds = sql.join(
        versions.map((version) => sql`${version.versionId}`),
        sql`, `,
      );
      const sections = (
        await tx.execute(sql`
          SELECT s.id, s.version_id AS "versionId", s.parent_section_id AS "parentSectionId",
                 s.kind, s.ref_key AS "refKey", s.number, s.heading, s.body, s.position,
                 s.source_page AS "sourcePage"
          FROM sections s
          WHERE s.organisation_id = ${scope.organisationId} AND s.version_id IN (${versionIds})
          ORDER BY s.version_id, s.position`)
      ).rows as unknown as SectionRow[];
      const byId = new Map(sections.map((section) => [section.id, section]));
      const sectionReferences = computeReferences(sections);

      const scores = new Map<string, number>();
      const bump = (id: string, score: number) => scores.set(id, (scores.get(id) ?? 0) + score);

      // 1. Sections the question names by number.
      for (const reference of references) {
        for (const section of sections) {
          const ref = sectionReferences.get(section.id)?.reference?.toLowerCase();
          const matches =
            reference.type === 'clause'
              ? ref === reference.reference && section.kind !== 'part' && section.kind !== 'chapter'
              : section.kind === reference.kind && ref === reference.display.toLowerCase();
          if (matches) bump(section.id, 10);
        }
      }

      // 2. Keyword relevance (any of the words; longer words also match their plurals).
      if (terms.length > 0) {
        const tsquery = terms.map((term) => (term.length >= 4 ? `${term}:*` : term)).join(' | ');
        const ranked = (
          await tx.execute(sql`
            SELECT s.id, ts_rank_cd(s.search_vector, q) AS rank
            FROM sections s CROSS JOIN to_tsquery('simple', ${tsquery}) AS q
            WHERE s.organisation_id = ${scope.organisationId} AND s.version_id IN (${versionIds})
              AND s.search_vector @@ q
            ORDER BY rank DESC LIMIT 30`)
        ).rows as { id: string; rank: number | string }[];
        for (const row of ranked) {
          const section = byId.get(row.id);
          if (!section) continue;
          const text = `${section.heading ?? ''} ${section.body}`.toLowerCase();
          const heading = (section.heading ?? '').toLowerCase();
          const covered = terms.filter((term) => text.includes(term)).length;
          const inHeading = terms.filter((term) => heading.includes(term)).length;
          // Require a real overlap: at least a third of the meaningful words, or a title word.
          if (covered / terms.length < 0.34 && inHeading === 0) continue;
          bump(row.id, Number(row.rank) * 4 + covered * 3 + inHeading * 2);
        }
      }

      const chosen = [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(id)!)
        .slice(0, 5);
      // A clause that only introduces its sub-items ("The objectives are:") needs them too.
      for (const section of [...chosen]) {
        for (const child of sections
          .filter((item) => item.parentSectionId === section.id)
          .slice(0, 6)) {
          if (!chosen.includes(child)) chosen.push(child);
        }
      }

      const versionById = new Map(versions.map((version) => [version.versionId, version]));
      const passages: Passage[] = [];
      let characters = 0;
      for (const section of chosen) {
        if (passages.length >= MAX_PASSAGES) break;
        if (characters + section.body.length > MAX_CHARACTERS && passages.length > 0) continue;
        characters += section.body.length;
        const reference = sectionReferences.get(section.id);
        const version = versionById.get(section.versionId)!;
        const location = (reference?.ancestorIds ?? [])
          .map((id) => byId.get(id))
          .filter((item): item is SectionRow => item !== undefined)
          .map((item) => [item.number, item.heading].filter(Boolean).join(' · '))
          .join(' › ');
        passages.push({
          id: `S${passages.length + 1}`,
          sectionId: section.id,
          refKey: section.refKey,
          kind: section.kind,
          number: section.number,
          heading: section.heading,
          reference: reference?.reference ?? null,
          referenceLabel: reference?.referenceLabel ?? null,
          location,
          body: section.body,
          sourcePage: section.sourcePage,
          constitutionId: version.constitutionId,
          constitutionTitle: version.title,
          versionId: version.versionId,
          versionNumber: Number(version.versionNumber),
          versionLabel: version.label,
          publishedAt: version.publishedAt ? new Date(version.publishedAt).toISOString() : null,
        });
      }
      return passages;
    });
  }
}
