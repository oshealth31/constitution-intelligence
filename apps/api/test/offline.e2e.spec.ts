// Stage 11: the content a device may keep for offline reading — published content only, no
// personal data, the same access rules as reading online (including subscription suspension),
// and a cheap status check that changes when the content changes.
import { organisations, subscriptions } from '@constitution/db';
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

const DAY = 86_400_000;

interface Org {
  id: string;
  ids: SampleTenantIds;
  admin: TestAgent;
  member: TestAgent;
  memberId: string;
}

interface Bundle {
  format: number;
  contentHash: string;
  generatedAt: string;
  usableUntil: string;
  userId: string;
  organisation: { id: string; slug: string; name: string };
  simpleWordsDisclaimer: string | null;
  constitutions: {
    id: string;
    title: string;
    version: { id: string; versionNumber: number; label: string };
    sections: { id: string; reference: string | null; body: string; simpleWords: string | null }[];
  }[];
}

describe.runIf(Boolean(testDatabaseUrl))('Offline reading content', () => {
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
    const member = await signedInMember(context, organisation.id, 'member');
    return {
      id: organisation.id,
      ids,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      member: member.agent,
      memberId: member.user.id,
    };
  }

  const url = (org: Org, path: string) => `/api/v1/organisations/${org.id}${path}`;

  beforeAll(async () => {
    context = await startTestApp();
    a = await createOrg('choir', 'Riverside Choir (fictional)', 'heron');
    b = await createOrg('netball', 'Hilltop Netball (fictional)', 'baobab');
  });

  afterAll(async () => {
    await context?.close();
  });

  it('contains only the published version, with dates, and is never cached by the browser', async () => {
    const response = await a.member.get(url(a, '/offline/bundle')).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const bundle = response.body as Bundle;
    expect(bundle.format).toBe(1);
    expect(bundle.userId).toBe(a.memberId);
    expect(bundle.organisation).toMatchObject({ id: a.id });
    expect(bundle.constitutions).toHaveLength(1);
    expect(bundle.constitutions[0]!.version.id).toBe(a.ids.publishedVersionId);
    expect(bundle.constitutions[0]!.sections.length).toBeGreaterThan(5);
    expect(bundle.constitutions[0]!.sections.some((section) => section.reference === '7')).toBe(
      true,
    );
    const usable = new Date(bundle.usableUntil).getTime() - new Date(bundle.generatedAt).getTime();
    expect(Math.round(usable / DAY)).toBe(30);

    const text = JSON.stringify(bundle);
    expect(text).not.toContain('herondraft'); // draft wording
    expect(text).not.toContain('Draft wording');
    expect(text).not.toContain('baobab'); // another organisation
  });

  it('holds no personal data: no e-mail addresses, names, members or questions', async () => {
    const text = JSON.stringify((await a.member.get(url(a, '/offline/bundle')).expect(200)).body);
    expect(text).not.toMatch(/@example\.test/);
    expect(text).not.toMatch(/"(email|displayName|members|memberships|password|session|token)"/i);
  });

  it('includes approved simple words (when the plan has them), never drafts', async () => {
    const overview = (await a.admin.get(url(a, '/manage/simple-words')).expect(200)).body as {
      constitutions: { clauses: { clause: { sectionId: string; reference: string | null } }[] }[];
    };
    const clauses = overview.constitutions[0]!.clauses;
    const ten = clauses.find((item) => item.clause.reference === '10')!.clause.sectionId;
    const nine = clauses.find((item) => item.clause.reference === '9')!.clause.sectionId;
    const statusBefore = (await a.member.get(url(a, '/offline/status')).expect(200)).body
      .contentHash;

    await a.admin
      .put(url(a, `/manage/simple-words/sections/${ten}`))
      .send({
        text: 'The constitution can be changed when two-thirds of the members at a general meeting agree.',
      })
      .expect(200);
    await a.admin
      .post(url(a, `/manage/simple-words/sections/${ten}/approve`))
      .send({ confirmed: true })
      .expect(200);
    await a.admin
      .put(url(a, `/manage/simple-words/sections/${nine}`))
      .send({ text: 'A draft that is not approved yet, about the money records.' })
      .expect(200);

    const bundle = (await a.member.get(url(a, '/offline/bundle')).expect(200)).body as Bundle;
    const sections = bundle.constitutions[0]!.sections;
    expect(sections.find((section) => section.id === ten)!.simpleWords).toContain('two-thirds');
    expect(sections.find((section) => section.id === nine)!.simpleWords).toBeNull();
    expect(bundle.simpleWordsDisclaimer).toContain('not legal advice');

    const statusAfter = (await a.member.get(url(a, '/offline/status')).expect(200)).body;
    expect(statusAfter.contentHash).not.toBe(statusBefore);
    expect(statusAfter.contentHash).toBe(bundle.contentHash);
  });

  it('the status changes when a new version is published (so devices know their copy is out of date)', async () => {
    const before = (await b.member.get(url(b, '/offline/status')).expect(200)).body;
    expect(before.usableUntil).toBeDefined();
    const upload = await b.admin
      .post(url(b, `/constitutions/${b.ids.constitutionId}/versions?label=Amended%202026`))
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'amended.pdf')
      .send(makeSamplePdf([[{ text: '1. Name' }, { text: 'The club is called Hilltop Netball.' }]]))
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

    const after = (await b.member.get(url(b, '/offline/status')).expect(200)).body;
    expect(after.contentHash).not.toBe(before.contentHash);
    const bundle = (await b.member.get(url(b, '/offline/bundle')).expect(200)).body as Bundle;
    expect(bundle.constitutions[0]!.version).toMatchObject({
      id: versionId,
      label: 'Amended 2026',
    });
  });

  it("refuses other organisations' content and people who are not signed in", async () => {
    await a.member.get(url(b, '/offline/bundle')).expect(404);
    await a.member.get(url(b, '/offline/status')).expect(404);
    await request(context.app.getHttpServer())
      .get(url(a, '/offline/bundle'))
      .set('X-Requested-With', 'XMLHttpRequest')
      .expect(401);
  });

  it('follows the subscription: suspended or restricted organisations cannot download or refresh', async () => {
    const org = await createOrg('choir', 'Suspended Choir (fictional)', 'egret');
    const [row] = await context.db.select().from(organisations).where(eq(organisations.id, org.id));
    const subscriptionId = row!.currentSubscriptionId!;

    await context.db
      .update(subscriptions)
      .set({ status: 'suspended', suspendedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
    const suspended = await org.member.get(url(org, '/offline/status')).expect(403);
    expect(suspended.body.error.reason).toBe('SUBSCRIPTION_INACTIVE');
    await org.member.get(url(org, '/offline/bundle')).expect(403);

    await context.db
      .update(subscriptions)
      .set({
        status: 'trialing',
        suspendedAt: null,
        currentPeriodStart: new Date(Date.now() - 90 * DAY),
        currentPeriodEnd: new Date(Date.now() - 60 * DAY),
      })
      .where(eq(subscriptions.id, subscriptionId));
    const restricted = await org.member.get(url(org, '/offline/bundle')).expect(403);
    expect(restricted.body.error.reason).toBe('SUBSCRIPTION_READ_ONLY');
  });
});
