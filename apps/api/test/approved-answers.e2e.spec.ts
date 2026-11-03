// Approved answers: drafting, automatic checks, approval, what members see, importing,
// organisation separation, and what happens when a new constitution version is published.
import { auditEvents } from '@constitution/db';
import { eq } from 'drizzle-orm';
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
  owner: TestAgent;
  admin: TestAgent;
  reviewer: TestAgent;
  member: TestAgent;
}

interface Clause {
  sectionId: string;
  reference: string | null;
  referenceLabel: string | null;
  heading: string | null;
  text: string;
  versionId: string;
  published: boolean;
}

interface Managed {
  id: string;
  question: string;
  answer: string;
  status: string;
  source: string;
  reviewReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  clauses: Clause[];
  issues: { code: string; blocking: boolean; message: string }[];
  readyToApprove: boolean;
}

interface MemberList {
  disclaimer: string;
  answers: { id: string; question: string; answer: string; clauses: Clause[] }[];
}

const CHANGE_ANSWER =
  'The constitution can be changed by a two-thirds majority at a general meeting, as long as notice of the change was sent with the meeting notice.';

describe.runIf(Boolean(testDatabaseUrl))('Approved answers', () => {
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
      owner: owner.agent,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      reviewer: (await signedInMember(context, organisation.id, 'content_reviewer')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
    };
  }

  const url = (org: Org, path: string) => `/api/v1/organisations/${org.id}${path}`;

  async function draft(
    org: Org,
    body: { question: string; answer: string; clauses: string[] },
    agent: TestAgent = org.admin,
  ) {
    return (await agent.post(url(org, '/manage/answers')).send(body).expect(201)).body as Managed;
  }

  async function approve(org: Org, id: string) {
    return (
      await org.admin
        .post(url(org, `/manage/answers/${id}/approve`))
        .send({ confirmed: true })
        .expect(200)
    ).body as Managed;
  }

  async function memberList(org: Org, agent: TestAgent = org.member) {
    return (await agent.get(url(org, '/answers')).expect(200)).body as MemberList;
  }

  async function match(org: Org, question: string) {
    return (
      await org.member
        .get(url(org, `/answers/match?question=${encodeURIComponent(question)}`))
        .expect(200)
    ).body as MemberList;
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
    it('creates a draft linked to the original clause, and keeps it away from members', async () => {
      const created = await draft(a, {
        question: 'How can the constitution be changed?',
        answer: CHANGE_ANSWER,
        clauses: ['10'],
      });
      expect(created).toMatchObject({ status: 'draft', source: 'manual', readyToApprove: true });
      expect(created.issues).toEqual([]);
      expect(created.clauses).toHaveLength(1);
      expect(created.clauses[0]).toMatchObject({ reference: '10', published: true });
      expect(created.clauses[0]!.text).toContain('two-thirds majority');

      expect((await memberList(a)).answers.map((item) => item.id)).not.toContain(created.id);
      expect((await match(a, 'How can the constitution be changed?')).answers).toHaveLength(0);
    });

    it('refuses clauses that are not in the published constitution', async () => {
      const response = await a.admin
        .post(url(a, '/manage/answers'))
        .send({
          question: 'What is rule 99?',
          answer: 'Rule 99 says nothing at all.',
          clauses: ['99'],
        })
        .expect(400);
      expect(JSON.stringify(response.body)).toContain('Clause 99');
      await a.admin
        .post(url(a, '/manage/answers'))
        .send({ question: 'No clauses?', answer: 'An answer without any clause.', clauses: [] })
        .expect(400);
    });

    it('blocks approval when the answer mentions a clause it is not linked to', async () => {
      const created = await draft(a, {
        question: 'How are decisions made?',
        answer: 'Clause 12 says each member has one vote and decisions need a simple majority.',
        clauses: ['8'],
      });
      expect(created.readyToApprove).toBe(false);
      expect(created.issues).toEqual([
        expect.objectContaining({ code: 'unknown_reference', blocking: true }),
      ]);
      const refused = await a.admin
        .post(url(a, `/manage/answers/${created.id}/approve`))
        .send({ confirmed: true })
        .expect(409);
      expect(refused.body.message).toContain('Clause 12');
    });

    it('warns (without blocking) about numbers that are not in the linked clauses', async () => {
      const created = await draft(a, {
        question: 'How much notice is needed for the annual general meeting?',
        answer: 'Members must get at least 14 days’ written notice of the annual general meeting.',
        clauses: ['6'],
      });
      expect(created.readyToApprove).toBe(true);
      expect(created.issues).toEqual([
        expect.objectContaining({ code: 'number_not_in_clauses', blocking: false }),
      ]);
      expect(created.issues[0]!.message).toContain('14');
    });
  });

  describe('approval and what members see', () => {
    let approvedId: string;

    it('only owners and administrators approve, after confirming they read the original', async () => {
      const created = await draft(
        a,
        {
          question: 'Can the constitution be amended, and how?',
          answer: CHANGE_ANSWER,
          clauses: ['Clause 10'],
        },
        a.reviewer,
      );
      await a.reviewer
        .post(url(a, `/manage/answers/${created.id}/approve`))
        .send({ confirmed: true })
        .expect(403);
      await a.admin
        .post(url(a, `/manage/answers/${created.id}/approve`))
        .send({ confirmed: false })
        .expect(400);
      const approved = await approve(a, created.id);
      expect(approved).toMatchObject({ status: 'approved' });
      expect(approved.approvedBy).toBeTruthy();
      expect(approved.approvedAt).toBeTruthy();
      approvedId = created.id;

      const events = await context.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.targetId, created.id));
      expect(events.map((item) => item.action)).toEqual(
        expect.arrayContaining(['answer.created', 'answer.approved']),
      );
      expect(JSON.stringify(events)).not.toContain('two-thirds');
    });

    it('shows approved answers to members, with the original clause and the disclaimer', async () => {
      const list = await memberList(a);
      expect(list.disclaimer).toContain('not legal advice');
      const shown = list.answers.find((item) => item.id === approvedId);
      expect(shown).toBeDefined();
      expect(shown!.clauses[0]!.text).toContain('two-thirds majority');

      const found = await match(a, 'How do we amend the constitution?');
      expect(found.answers.map((item) => item.id)).toContain(approvedId);
      expect(found.disclaimer).toContain('not legal advice');
      expect((await match(a, 'Who won the football world cup?')).answers).toHaveLength(0);
    });

    it('members cannot see or use the management side', async () => {
      await a.member.get(url(a, '/manage/answers')).expect(403);
      await a.member
        .post(url(a, '/manage/answers'))
        .send({ question: 'Mine?', answer: 'A member trying to write one.', clauses: ['10'] })
        .expect(403);
      await request(context.app.getHttpServer())
        .get(url(a, '/answers'))
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(401);
    });

    it('editing an approved answer hides it until it is approved again', async () => {
      const edited = (
        await a.admin
          .patch(url(a, `/manage/answers/${approvedId}`))
          .send({ answer: `${CHANGE_ANSWER} Ask the Secretary for the meeting notice.` })
          .expect(200)
      ).body as Managed;
      expect(edited).toMatchObject({ status: 'draft', approvedAt: null });
      expect((await memberList(a)).answers.map((item) => item.id)).not.toContain(approvedId);
      await approve(a, approvedId);
      expect((await memberList(a)).answers.map((item) => item.id)).toContain(approvedId);
    });

    it('retires, restores and deletes answers safely', async () => {
      await a.admin.delete(url(a, `/manage/answers/${approvedId}`)).expect(409);
      await a.reviewer.post(url(a, `/manage/answers/${approvedId}/retire`)).expect(403);
      await a.admin.post(url(a, `/manage/answers/${approvedId}/retire`)).expect(200);
      expect((await memberList(a)).answers.map((item) => item.id)).not.toContain(approvedId);
      const restored = (
        await a.admin.post(url(a, `/manage/answers/${approvedId}/restore`)).expect(200)
      ).body as Managed;
      expect(restored.status).toBe('draft');
      await a.admin.delete(url(a, `/manage/answers/${approvedId}`)).expect(204);
      await a.admin.get(url(a, `/manage/answers/${approvedId}`)).expect(404);
    });
  });

  describe('importing drafts', () => {
    it('imports drafts (marking AI drafts), never approves them, and notes unknown clauses', async () => {
      const report = (
        await a.admin
          .post(url(a, '/manage/answers/import'))
          .send({
            answers: [
              {
                question: 'Who keeps the accounts?',
                answer:
                  'The Treasurer keeps the accounts and presents them at every annual general meeting.',
                clauses: ['9'],
                draftedBy: 'ai',
              },
              {
                question: 'What does clause 42 say?',
                answer: 'This draft points at a clause that does not exist.',
                clauses: ['42'],
              },
            ],
          })
          .expect(200)
      ).body as { created: { id: string; unresolved: string[] }[] };
      expect(report.created).toHaveLength(2);
      expect(report.created[1]!.unresolved).toEqual(['Clause 42']);

      const first = (
        await a.admin.get(url(a, `/manage/answers/${report.created[0]!.id}`)).expect(200)
      ).body as Managed;
      expect(first).toMatchObject({ status: 'draft', source: 'ai', readyToApprove: true });
      const second = (
        await a.admin.get(url(a, `/manage/answers/${report.created[1]!.id}`)).expect(200)
      ).body as Managed;
      expect(second).toMatchObject({ status: 'draft', source: 'import', readyToApprove: false });
      expect(second.reviewReason).toContain('Clause 42');

      const visible = (await memberList(a)).answers.map((item) => item.id);
      expect(visible).not.toContain(report.created[0]!.id);
      expect(visible).not.toContain(report.created[1]!.id);
    });

    it('refuses an import that is too large or malformed', async () => {
      const row = { question: 'Question?', answer: 'An answer long enough.', clauses: ['9'] };
      await a.admin
        .post(url(a, '/manage/answers/import'))
        .send({ answers: Array.from({ length: 201 }, () => row) })
        .expect(400);
      await a.admin
        .post(url(a, '/manage/answers/import'))
        .send({ answers: [{ question: 'Q?', answer: 'short' }] })
        .expect(400);
    });
  });

  describe('organisation separation', () => {
    it("never shows or links another organisation's answers or clauses", async () => {
      const bAnswer = await draft(b, {
        question: 'Who keeps the baobab fund accounts?',
        answer:
          'The Treasurer keeps the accounts, which are shown at every annual general meeting.',
        clauses: ['9'],
      });
      await approve(b, bAnswer.id);

      await a.admin.get(url(a, `/manage/answers/${bAnswer.id}`)).expect(404);
      await a.admin
        .patch(url(a, `/manage/answers/${bAnswer.id}`))
        .send({ answer: 'Trying to change another organisation.' })
        .expect(404);
      await a.admin
        .post(url(a, `/manage/answers/${bAnswer.id}/approve`))
        .send({ confirmed: true })
        .expect(404);
      await a.admin.get(url(b, '/manage/answers')).expect(404);
      await a.member.get(url(b, '/answers')).expect(404);

      expect(JSON.stringify(await memberList(a))).not.toContain('baobab');
      expect(JSON.stringify(await match(a, 'Who keeps the baobab fund accounts?'))).not.toContain(
        'baobab',
      );
      // Clause 9 resolves to organisation A's own clause, never B's.
      const own = await draft(a, {
        question: 'Who keeps our accounts?',
        answer: 'The Treasurer keeps the accounts for the choir.',
        clauses: ['9'],
      });
      expect(own.clauses[0]!.text).toContain('heron');
      expect(own.clauses[0]!.text).not.toContain('baobab');
    });
  });

  describe('when a new version is published', () => {
    it('carries over answers whose clauses kept their wording, and holds back the others', async () => {
      const unchanged = await approve(
        b,
        (
          await draft(b, {
            question: 'How can the constitution be changed?',
            answer: CHANGE_ANSWER,
            clauses: ['10'],
          })
        ).id,
      );
      const changing = await approve(
        b,
        (
          await draft(b, {
            question: 'How much notice is needed for the annual general meeting?',
            answer:
              'Members must receive at least 21 days’ written notice of the annual general meeting.',
            clauses: ['6'],
          })
        ).id,
      );
      const clause10 = unchanged.clauses[0]!.text;

      // New version: clause 10 word for word the same, clause 6 now says 14 days.
      const lines = [
        'CONSTITUTION OF HILLTOP NETBALL',
        '6. Annual general meeting',
        'An annual general meeting must be held every year. Members must receive at least 14 days written notice.',
        '10. Changing this constitution',
        clause10,
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
        await b.admin
          .post(url(b, `/versions/${versionId}/sections/${flagged.id}/resolve`))
          .expect(200);
      }
      await b.admin
        .post(url(b, `/versions/${versionId}/submit`))
        .send({ confirmed: true })
        .expect(200);
      await b.admin
        .post(url(b, `/versions/${versionId}/approve`))
        .send({})
        .expect(200);
      await b.admin
        .post(url(b, `/versions/${versionId}/publish`))
        .send({ confirmed: true })
        .expect(200);

      const carried = (await b.admin.get(url(b, `/manage/answers/${unchanged.id}`)).expect(200))
        .body as Managed;
      expect(carried.status).toBe('approved');
      expect(carried.clauses[0]).toMatchObject({ versionId, published: true, text: clause10 });

      const held = (await b.admin.get(url(b, `/manage/answers/${changing.id}`)).expect(200))
        .body as Managed;
      expect(held).toMatchObject({ status: 'needs_review', approvedAt: null });
      expect(held.reviewReason).toContain('Clause 6');
      expect(held.readyToApprove).toBe(false); // still linked to the old wording

      const visible = (await memberList(b)).answers.map((item) => item.id);
      expect(visible).toContain(unchanged.id);
      expect(visible).not.toContain(changing.id);

      // Re-linking to the new clause lets an administrator approve it again.
      const relinked = (
        await b.admin
          .patch(url(b, `/manage/answers/${changing.id}`))
          .send({
            answer:
              'Members must receive at least 14 days’ written notice of the annual general meeting.',
            clauses: ['6'],
          })
          .expect(200)
      ).body as Managed;
      expect(relinked).toMatchObject({ status: 'draft', readyToApprove: true });
      expect(relinked.issues).toEqual([]);
      await approve(b, changing.id);
      expect((await memberList(b)).answers.map((item) => item.id)).toContain(changing.id);
    });
  });
});
