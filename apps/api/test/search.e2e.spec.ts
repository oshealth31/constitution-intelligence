// Search and constitution reader: keyword, clause-number and title search, clause references,
// verbatim excerpts, permissions, tenant isolation and version correctness.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrichSampleConstitution } from '../src/dev/sample-branding';
import { makeSamplePdf, sampleConstitutionLines } from '../src/dev/sample-documents';
import { createSampleTenantContent, type SampleTenantIds } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  createOrganisation,
  signedInMember,
  startTestApp,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

interface Org {
  id: string;
  ids: SampleTenantIds;
  owner: TestAgent;
  admin: TestAgent;
  reviewer: TestAgent;
  member: TestAgent;
}

interface Result {
  sectionId: string;
  refKey: string;
  number: string | null;
  heading: string | null;
  reference: string | null;
  referenceLabel: string | null;
  path: { refKey: string; number: string | null; heading: string | null }[];
  excerpt: string;
  matchedBy: 'reference' | 'title' | 'text';
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  constitutionId: string;
}

describe.runIf(Boolean(testDatabaseUrl))('search and constitution reader', () => {
  let context: TestContext;
  let a: Org;
  let b: Org;

  async function createOrg(
    variant: 'choir' | 'netball',
    name: string,
    uniqueWord: string,
  ): Promise<Org> {
    const organisation = await createOrganisation(context.db);
    const owner = await signedInMember(context, organisation.id, 'owner');
    const ids = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisation.id, owner.user.id, 'owner'),
      {
        name,
        uniqueWord,
        beforePublish: (versionId) =>
          enrichSampleConstitution(context.db, organisation.id, versionId, variant, uniqueWord),
      },
    );
    return {
      id: organisation.id,
      ids,
      owner: owner.agent,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      reviewer: (await signedInMember(context, organisation.id, 'content_reviewer')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
    };
  }

  const url = (org: Org, path: string) => `/api/v1/organisations/${org.id}${path}`;
  const search = async (agent: TestAgent, org: Org, q: string, extra = '') =>
    (await agent.get(url(org, `/search?q=${encodeURIComponent(q)}${extra}`)).expect(200)).body as {
      interpretedAs: { type: string; display: string } | null;
      terms: string[];
      results: Result[];
      suggestions: string[];
    };

  beforeAll(async () => {
    context = await startTestApp();
    a = await createOrg('choir', 'Riverside Choir (fictional)', 'heron');
    b = await createOrg('netball', 'Hilltop Netball (fictional)', 'baobab');
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('search accuracy', () => {
    it('finds a section by its title, with its clause reference and the version', async () => {
      const { results } = await search(a.member, a, 'quorum');
      expect(results[0]).toMatchObject({
        refKey: 's2',
        number: '7',
        heading: 'Quorum',
        reference: '7',
        referenceLabel: 'Clause 7',
        matchedBy: 'title',
        versionId: a.ids.publishedVersionId,
        versionNumber: 1,
        versionLabel: 'Registered constitution',
        constitutionId: a.ids.constitutionId,
      });
      expect(results[0]!.path).toEqual([
        { refKey: 'part-3', number: 'Part 3', heading: 'Meetings and decisions' },
      ]);
    });

    it('finds words anywhere in the text', async () => {
      const { results, terms } = await search(a.member, a, 'two-thirds majority');
      expect(results[0]).toMatchObject({
        refKey: 'amendments',
        reference: '10',
        matchedBy: 'text',
      });
      expect(terms).toEqual(['two-thirds', 'majority']);
      expect(results[0]!.excerpt).toContain('two-thirds majority');
    });

    it('finds a clause by its number, however it is typed', async () => {
      for (const query of ['7', 'clause 7', 'Clause 7', 'section 7', 'cl. 7', '§7']) {
        const response = await search(a.member, a, query);
        expect(response.interpretedAs, query).toEqual({ type: 'clause', display: 'Clause 7' });
        expect(response.results[0], query).toMatchObject({
          refKey: 's2',
          matchedBy: 'reference',
          heading: 'Quorum',
        });
      }
    });

    it('finds lettered sub-clauses and parts by reference', async () => {
      for (const query of ['2(a)', '2 (a)', 'clause 2a', 'Clause 2 (a)']) {
        const { results } = await search(a.member, a, query);
        expect(results[0], query).toMatchObject({
          refKey: 'objectives-a',
          number: '(a)',
          reference: '2(a)',
          referenceLabel: 'Clause 2(a)',
          matchedBy: 'reference',
        });
        expect(
          results[0]!.path.map((item) => item.refKey),
          query,
        ).toEqual(['part-1', 'objectives']);
      }
      for (const query of ['Part 3', 'part III', 'part three']) {
        const { results } = await search(a.member, a, query);
        expect(results[0], query).toMatchObject({ refKey: 'part-3', reference: 'Part 3' });
      }
    });

    it('puts section titles before passing mentions in the text', async () => {
      const { results } = await search(a.member, a, 'general meeting');
      expect(results[0]).toMatchObject({
        refKey: 'agm',
        heading: 'Annual general meeting',
        matchedBy: 'title',
      });
      expect(results.map((result) => result.refKey)).toContain('s2'); // "...for a general meeting..."
    });

    it('says clearly when nothing matches, and suggests similar titles', async () => {
      const misspelt = await search(a.member, a, 'quorom');
      expect(misspelt.results).toEqual([]);
      expect(misspelt.suggestions).toContain('Quorum');

      const missingClause = await search(a.member, a, 'clause 99');
      expect(missingClause.results).toEqual([]);
      expect(missingClause.interpretedAs).toEqual({ type: 'clause', display: 'Clause 99' });

      const nothing = await search(a.member, a, 'xylophone');
      expect(nothing).toMatchObject({ results: [], suggestions: [] });
    });
  });

  describe('original wording and references', () => {
    it('returns the stored wording unchanged: excerpts are exact slices of the text', async () => {
      const { results } = await search(a.member, a, 'members');
      expect(results.length).toBeGreaterThan(2);
      const sections = (
        await a.member.get(url(a, `/versions/${a.ids.publishedVersionId}/sections`)).expect(200)
      ).body as (Result & { id: string; body: string })[];
      for (const result of results) {
        const section = sections.find((item) => item.id === result.sectionId)!;
        expect(result.number).toBe(section.number);
        expect(result.heading).toBe(section.heading);
        expect(section.body).toContain(result.excerpt.replace(/^…/, '').replace(/…$/, ''));
      }
    });

    it('gives every section in the reader its reference, taken only from stored numbers', async () => {
      const sections = (
        await a.member.get(url(a, `/versions/${a.ids.publishedVersionId}/sections`)).expect(200)
      ).body as {
        refKey: string;
        reference: string | null;
        referenceLabel: string | null;
        sourcePage: number | null;
      }[];
      const byKey = Object.fromEntries(sections.map((section) => [section.refKey, section]));
      expect(byKey['part-2']).toMatchObject({ reference: 'Part 2', referenceLabel: 'Part 2' });
      expect(byKey['s3']).toMatchObject({ reference: '3', referenceLabel: 'Clause 3' });
      expect(byKey['objectives-c']).toMatchObject({
        reference: '2(c)',
        referenceLabel: 'Clause 2(c)',
      });
      expect(sections.every((section) => 'sourcePage' in section)).toBe(true);
    });
  });

  describe('permissions and tenant isolation', () => {
    it('requires a signed-in member of the organisation', async () => {
      await request(context.app.getHttpServer()).get(url(a, '/search?q=quorum')).expect(401);
      await b.member.get(url(a, '/search?q=quorum')).expect(404);
      await b.owner.get(url(a, '/search?q=7')).expect(404);
    });

    it('checks the query', async () => {
      await a.member.get(url(a, '/search?q=')).expect(400);
      await a.member.get(url(a, '/search?q=a')).expect(400);
      await a.member.get(url(a, `/search?q=${'x'.repeat(201)}`)).expect(400);
      await a.member.get(url(a, '/search?q=7')).expect(200);
    });

    it("never returns another organisation's text, numbers or documents", async () => {
      expect((await search(a.member, a, 'baobab')).results).toEqual([]);
      expect((await search(b.member, b, 'heron')).results).toEqual([]);
      for (const query of ['clause 7', 'quorum', 'Part 3', 'members']) {
        const { results } = await search(a.member, a, query);
        expect(results.length, query).toBeGreaterThan(0);
        expect(
          results.every((result) => result.versionId === a.ids.publishedVersionId),
          query,
        ).toBe(true);
      }
      await a.member
        .get(url(a, `/search?q=quorum&constitutionId=${b.ids.constitutionId}`))
        .expect(404);
      const filtered = await search(
        a.member,
        a,
        'quorum',
        `&constitutionId=${a.ids.constitutionId}`,
      );
      expect(filtered.results.length).toBeGreaterThan(0);
    });
  });

  describe('version correctness', () => {
    async function upload(agent: TestAgent, org: Org, lines: string[]) {
      const response = await agent
        .post(
          url(
            org,
            `/constitutions/${org.ids.constitutionId}/versions?label=${encodeURIComponent('Amended 2026')}`,
          ),
        )
        .set('Content-Type', 'application/pdf')
        .set('X-File-Name', 'amended.pdf')
        .send(makeSamplePdf([lines.map((text) => ({ text }))]))
        .expect(201);
      return response.body.id as string;
    }

    it('never searches drafts, versions in review or approved-but-unpublished versions', async () => {
      const draftId = await upload(a.admin, a, [
        ...sampleConstitutionLines('Riverside Choir'),
        '5. Draft rule',
        'Proposed wording (pelicandraft).',
      ]);
      for (const agent of [a.member, a.reviewer, a.owner]) {
        expect((await search(agent, a, 'pelicandraft')).results).toEqual([]);
      }
      await a.admin
        .post(url(a, `/versions/${draftId}/submit`))
        .send({ confirmed: true })
        .expect(200);
      expect((await search(a.owner, a, 'pelicandraft')).results).toEqual([]);
      await a.admin
        .post(url(a, `/versions/${draftId}/approve`))
        .send({})
        .expect(200);
      expect((await search(a.owner, a, 'pelicandraft')).results).toEqual([]);
      await a.admin
        .post(url(a, `/versions/${draftId}/archive`))
        .send({ comment: 'Not adopted after all.' })
        .expect(200);
    });

    it('switches to the new wording, numbers and version as soon as a new version is published', async () => {
      const newId = await upload(a.admin, a, [
        ...sampleConstitutionLines('Riverside Choir'),
        '5. Dissolution',
        'Remaining money goes to a similar charity (osprey).',
      ]);
      await a.admin
        .post(url(a, `/versions/${newId}/submit`))
        .send({ confirmed: true })
        .expect(200);
      await a.admin
        .post(url(a, `/versions/${newId}/approve`))
        .send({})
        .expect(200);
      await a.admin
        .post(url(a, `/versions/${newId}/publish`))
        .send({ confirmed: true })
        .expect(200);

      const quorum = await search(a.member, a, 'quorum');
      expect(quorum.results.length).toBeGreaterThan(0);
      expect(quorum.results.every((result) => result.versionId === newId)).toBe(true);
      expect(quorum.results[0]).toMatchObject({
        number: '4',
        reference: '4',
        versionLabel: 'Amended 2026',
        versionNumber: expect.any(Number),
      });
      // Clause 7 existed only in the old (now superseded) version.
      expect((await search(a.member, a, 'clause 7')).results).toEqual([]);
      expect((await search(a.member, a, 'heron')).results).toEqual([]);
      expect((await search(a.member, a, 'osprey')).results[0]).toMatchObject({
        reference: '5',
        heading: 'Dissolution',
      });
    });
  });
});
