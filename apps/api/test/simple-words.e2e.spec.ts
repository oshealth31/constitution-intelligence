// Simple words: plain-language versions of clauses. Drafting, checks, approval, what members
// see, importing, organisation separation, and what happens when a new version is published.
import { auditEvents } from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrichSampleConstitution } from '../src/dev/sample-branding';
import { makeSamplePdf } from '../src/dev/sample-documents';
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
  admin: TestAgent;
  reviewer: TestAgent;
  member: TestAgent;
}

interface Simple {
  id: string;
  text: string;
  status: string;
  source: string;
  reviewReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  issues: { code: string; blocking: boolean; message: string }[];
  readyToApprove: boolean;
}

interface Overview {
  constitutions: {
    versionId: string;
    clauses: {
      clause: { sectionId: string; reference: string | null; heading: string | null; text: string };
      simple: Simple | null;
    }[];
  }[];
}

describe.runIf(Boolean(testDatabaseUrl))('Simple words', () => {
  let context: TestContext;
  let a: Org;
  let b: Org;

  async function createOrg(variant: 'choir' | 'netball', name: string, uniqueWord: string) {
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
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      reviewer: (await signedInMember(context, organisation.id, 'content_reviewer')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
    };
  }

  const url = (org: Org, path: string) => `/api/v1/organisations/${org.id}${path}`;

  async function overview(org: Org) {
    return (await org.admin.get(url(org, '/manage/simple-words')).expect(200)).body as Overview;
  }

  async function clauseId(org: Org, reference: string) {
    const found = (await overview(org)).constitutions
      .flatMap((item) => item.clauses)
      .find((item) => item.clause.reference === reference);
    if (!found) throw new Error(`No clause ${reference}`);
    return found.clause.sectionId;
  }

  async function save(org: Org, sectionId: string, text: string, agent: TestAgent = org.admin) {
    return (
      await agent
        .put(url(org, `/manage/simple-words/sections/${sectionId}`))
        .send({ text })
        .expect(200)
    ).body as Simple;
  }

  async function approve(org: Org, sectionId: string) {
    return (
      await org.admin
        .post(url(org, `/manage/simple-words/sections/${sectionId}/approve`))
        .send({ confirmed: true })
        .expect(200)
    ).body as Simple;
  }

  async function memberView(org: Org, versionId: string, agent: TestAgent = org.member) {
    return (
      await agent.get(url(org, `/simple-words?versionId=${versionId}`)).expect(200)
    ).body as { disclaimer: string; items: { sectionId: string; text: string }[] };
  }

  beforeAll(async () => {
    context = await startTestApp();
    a = await createOrg('choir', 'Riverside Choir (fictional)', 'heron');
    b = await createOrg('netball', 'Hilltop Netball (fictional)', 'baobab');
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('drafting and checks', () => {
    it('lists only clauses with text from the current published version', async () => {
      const list = await overview(a);
      expect(list.constitutions).toHaveLength(1);
      expect(list.constitutions[0]!.versionId).toBe(a.ids.publishedVersionId);
      const all = JSON.stringify(list);
      expect(all).not.toContain('herondraft');
      expect(all).not.toContain('baobab');
      expect(list.constitutions[0]!.clauses.every((item) => item.clause.text.trim() !== '')).toBe(
        true,
      );
    });

    it('saves a draft that members cannot see', async () => {
      const id = await clauseId(a, '10');
      const saved = await save(
        a,
        id,
        'You can change the constitution if two-thirds of the members at a general meeting agree, and the change was sent out with the meeting notice.',
        a.reviewer,
      );
      expect(saved).toMatchObject({ status: 'draft', source: 'manual', readyToApprove: true });
      expect(saved.issues).toEqual([]);
      expect((await memberView(a, a.ids.publishedVersionId)).items).toHaveLength(0);
    });

    it('blocks approval when other clause numbers are mentioned; warns about other amounts', async () => {
      const id = await clauseId(a, '8');
      const wrong = await save(a, id, 'Each member has one vote, as Clause 12 also says.');
      expect(wrong.readyToApprove).toBe(false);
      const refused = await a.admin
        .post(url(a, `/manage/simple-words/sections/${id}/approve`))
        .send({ confirmed: true })
        .expect(409);
      expect(refused.body.error.message).toContain('Clause 12');

      const warned = await save(a, id, 'Each member has one vote. Half the members must agree.');
      expect(warned.readyToApprove).toBe(true);
      expect(warned.issues).toEqual([
        expect.objectContaining({ code: 'number_not_in_clauses', blocking: false }),
      ]);
    });

    it('refuses headings without text, draft versions and other organisations’ clauses', async () => {
      // A Part heading has no text of its own.
      const part = (
        await context.db.execute(sql`SELECT id FROM sections
          WHERE organisation_id = ${a.id} AND version_id = ${a.ids.publishedVersionId}
            AND kind = 'part' LIMIT 1`)
      ).rows[0] as { id: string } | undefined;
      await a.admin
        .put(url(a, `/manage/simple-words/sections/${part!.id}`))
        .send({ text: 'Part one is about general things.' })
        .expect(400);
      const draftSection = (
        await context.db.execute(
          sql`SELECT id FROM sections
            WHERE organisation_id = ${a.id} AND version_id <> ${a.ids.publishedVersionId} LIMIT 1`,
        )
      ).rows[0] as { id: string };
      await a.admin
        .put(url(a, `/manage/simple-words/sections/${draftSection.id}`))
        .send({ text: 'Simple words for a draft clause.' })
        .expect(404);
      const bClause = await clauseId(b, '10');
      await a.admin
        .put(url(a, `/manage/simple-words/sections/${bClause}`))
        .send({ text: 'Trying to write for another organisation.' })
        .expect(404);
    });
  });

  describe('approval and what members see', () => {
    it('only owners and administrators approve, after confirming', async () => {
      const id = await clauseId(a, '10');
      await a.reviewer
        .post(url(a, `/manage/simple-words/sections/${id}/approve`))
        .send({ confirmed: true })
        .expect(403);
      await a.admin
        .post(url(a, `/manage/simple-words/sections/${id}/approve`))
        .send({ confirmed: false })
        .expect(400);
      const approved = await approve(a, id);
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBeTruthy();

      const shown = await memberView(a, a.ids.publishedVersionId);
      expect(shown.disclaimer).toContain('not legal advice');
      expect(shown.items).toEqual([
        expect.objectContaining({ sectionId: id, text: expect.stringContaining('two-thirds') }),
      ]);

      const events = await context.db.select().from(auditEvents).where(eq(auditEvents.targetId, id));
      expect(events.map((event) => event.action)).toEqual(
        expect.arrayContaining(['simple_words.saved', 'simple_words.approved']),
      );
      expect(JSON.stringify(events)).not.toContain('two-thirds');
    });

    it('editing hides it again; approved ones must be withdrawn before deleting', async () => {
      const id = await clauseId(a, '10');
      const edited = await save(
        a,
        id,
        'The constitution can be changed when two-thirds of the members at a general meeting vote for it.',
      );
      expect(edited).toMatchObject({ status: 'draft', approvedAt: null });
      expect((await memberView(a, a.ids.publishedVersionId)).items).toHaveLength(0);

      await approve(a, id);
      await a.admin.delete(url(a, `/manage/simple-words/sections/${id}`)).expect(409);
      await a.reviewer.post(url(a, `/manage/simple-words/sections/${id}/withdraw`)).expect(403);
      const withdrawn = (
        await a.admin.post(url(a, `/manage/simple-words/sections/${id}/withdraw`)).expect(200)
      ).body as Simple;
      expect(withdrawn.status).toBe('draft');
      await a.admin.delete(url(a, `/manage/simple-words/sections/${id}`)).expect(204);
      // Approved again, for the import test below.
      await save(a, id, edited.text);
      await approve(a, id);
    });

    it('members cannot use the management side; drafts versions show nothing', async () => {
      await a.member.get(url(a, '/manage/simple-words')).expect(403);
      await a.member
        .put(url(a, `/manage/simple-words/sections/${await clauseId(a, '10')}`))
        .send({ text: 'A member trying to write simple words.' })
        .expect(403);
      await request(context.app.getHttpServer())
        .get(url(a, `/simple-words?versionId=${a.ids.publishedVersionId}`))
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(401);
      const draftVersion = (
        await context.db.execute(
          sql`SELECT id FROM constitution_versions
            WHERE organisation_id = ${a.id} AND status = 'draft' LIMIT 1`,
        )
      ).rows[0] as { id: string };
      expect((await memberView(a, draftVersion.id)).items).toHaveLength(0);
    });
  });

  describe('importing drafts', () => {
    it('imports drafts, marks AI drafts, and skips unknown or already-approved clauses', async () => {
      const report = (
        await a.admin
          .post(url(a, '/manage/simple-words/import'))
          .send({
            items: [
              {
                clause: '9',
                text: 'The Treasurer looks after the money records and shows them at every annual general meeting.',
                draftedBy: 'ai',
              },
              { clause: '42', text: 'A clause that does not exist.' },
              { clause: '10', text: 'Trying to overwrite approved simple words.' },
            ],
          })
          .expect(200)
      ).body as { saved: { clause: string }[]; skipped: { clause: string; reason: string }[] };
      expect(report.saved.map((item) => item.clause)).toEqual(['9']);
      expect(report.skipped.map((item) => item.clause)).toEqual(['42', '10']);

      const clause9 = (await overview(a)).constitutions[0]!.clauses.find(
        (item) => item.clause.reference === '9',
      )!;
      expect(clause9.simple).toMatchObject({ status: 'draft', source: 'ai' });
      const visible = (await memberView(a, a.ids.publishedVersionId)).items.map(
        (item) => item.sectionId,
      );
      expect(visible).not.toContain(clause9.clause.sectionId);
    });
  });

  describe('organisation separation', () => {
    it("never shows another organisation's simple words", async () => {
      const id = await clauseId(b, '9');
      await save(b, id, 'The Treasurer keeps the baobab fund records and shows them every year.');
      await approve(b, id);
      await a.member.get(url(b, `/simple-words?versionId=${b.ids.publishedVersionId}`)).expect(404);
      expect((await memberView(a, b.ids.publishedVersionId)).items).toHaveLength(0);
      await a.admin.post(url(a, `/manage/simple-words/sections/${id}/withdraw`)).expect(404);
      await a.admin.get(url(b, '/manage/simple-words')).expect(404);
      expect(JSON.stringify(await overview(a))).not.toContain('baobab');
    });
  });

  describe('when a new version is published', () => {
    it('keeps approved simple words for unchanged clauses, and holds back changed ones', async () => {
      const clause10 = await clauseId(b, '10');
      const clause6 = await clauseId(b, '6');
      await save(b, clause10, 'You can change the constitution if two-thirds of members at a general meeting agree.');
      await approve(b, clause10);
      await save(b, clause6, 'There must be an annual general meeting every year, with 21 days’ written notice.');
      await approve(b, clause6);
      const text10 = (await overview(b)).constitutions[0]!.clauses.find(
        (item) => item.clause.reference === '10',
      )!.clause.text;

      const lines = [
        'CONSTITUTION OF HILLTOP NETBALL',
        '6. Annual general meeting',
        'An annual general meeting must be held every year. Members must receive at least 14 days written notice.',
        '10. Changing this constitution',
        // The sample PDF writer cuts very long lines, so the wording goes over two lines.
        text10.slice(0, text10.indexOf(' ', 60)),
        text10.slice(text10.indexOf(' ', 60) + 1),
      ];
      const upload = await b.admin
        .post(url(b, `/constitutions/${b.ids.constitutionId}/versions?label=Amended%202026`))
        .set('Content-Type', 'application/pdf')
        .set('X-File-Name', 'amended.pdf')
        .send(makeSamplePdf([lines.map((text) => ({ text }))]))
        .expect(201);
      const versionId = upload.body.id as string;
      for (const flagged of upload.body.sections.filter(
        (section: { needsReview: boolean }) => section.needsReview,
      )) {
        await b.admin.post(url(b, `/versions/${versionId}/sections/${flagged.id}/resolve`)).expect(200);
      }
      await b.admin.post(url(b, `/versions/${versionId}/submit`)).send({ confirmed: true }).expect(200);
      await b.admin.post(url(b, `/versions/${versionId}/approve`)).send({}).expect(200);
      await b.admin.post(url(b, `/versions/${versionId}/publish`)).send({ confirmed: true }).expect(200);

      const after = await overview(b);
      expect(after.constitutions[0]!.versionId).toBe(versionId);
      const byRef = new Map(after.constitutions[0]!.clauses.map((item) => [item.clause.reference, item]));
      expect(byRef.get('10')!.simple).toMatchObject({ status: 'approved' });
      expect(byRef.get('6')!.simple).toMatchObject({ status: 'needs_review', approvedAt: null });
      expect(byRef.get('6')!.simple!.reviewReason).toContain('Clause 6');

      const shown = (await memberView(b, versionId)).items.map((item) => item.sectionId);
      expect(shown).toContain(byRef.get('10')!.clause.sectionId);
      expect(shown).not.toContain(byRef.get('6')!.clause.sectionId);
      // The old version is superseded: members are not shown simple words for it any more.
      expect((await memberView(b, b.ids.publishedVersionId)).items).toHaveLength(0);

      // An administrator checks the copied words against the new wording and approves them.
      await save(b, byRef.get('6')!.clause.sectionId, 'There must be an annual general meeting every year, with 14 days’ written notice.');
      await approve(b, byRef.get('6')!.clause.sectionId);
      expect((await memberView(b, versionId)).items.map((item) => item.sectionId)).toContain(
        byRef.get('6')!.clause.sectionId,
      );
    });
  });
});
