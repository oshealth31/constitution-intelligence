// Constitution document management: upload validation, private storage, extraction with review
// flags, corrections, the version workflow and approval permissions, and tenant isolation.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeSampleDocx,
  makeSamplePdf,
  sampleConstitutionLines,
} from '../src/dev/sample-documents';
import { createSampleTenantContent, type SampleTenantIds } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { TenantDatabase } from '../src/modules/tenancy/tenant-database.service';
import { createTenantScope, type TenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  auditEventsFor,
  createOrganisation,
  signedInMember,
  startTestApp,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const MAX_BYTES = 200_000;

interface Org {
  id: string;
  ids: SampleTenantIds;
  scope: TenantScope;
  owner: TestAgent;
  admin: TestAgent;
  reviewer: TestAgent;
  member: TestAgent;
  auditor: TestAgent;
}

interface Section {
  id: string;
  number: string | null;
  heading: string | null;
  body: string;
  needsReview: boolean;
  reviewReason: string | null;
}

describe.runIf(Boolean(testDatabaseUrl))('constitution document management', () => {
  let context: TestContext;
  let a: Org;
  let b: Org;

  async function createOrg(name: string, uniqueWord: string): Promise<Org> {
    const organisation = await createOrganisation(context.db);
    const owner = await signedInMember(context, organisation.id, 'owner');
    const scope = createTenantScope(organisation.id, owner.user.id, 'owner');
    const ids = await createSampleTenantContent(context.db, context.app.get(FilesService), scope, {
      name,
      uniqueWord,
    });
    return {
      id: organisation.id,
      ids,
      scope,
      owner: owner.agent,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      reviewer: (await signedInMember(context, organisation.id, 'content_reviewer')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
      auditor: (await signedInMember(context, organisation.id, 'auditor')).agent,
    };
  }

  const url = (org: Org, path: string) => `/api/v1/organisations/${org.id}${path}`;

  function upload(
    agent: TestAgent,
    org: Org,
    fileName: string,
    content: Buffer,
    options: { constitutionId?: string; label?: string; contentType?: string } = {},
  ) {
    const constitutionId = options.constitutionId ?? org.ids.constitutionId;
    const query = options.label ? `?label=${encodeURIComponent(options.label)}` : '';
    return agent
      .post(url(org, `/constitutions/${constitutionId}/versions${query}`))
      .set('Content-Type', options.contentType ?? 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(fileName))
      .send(content);
  }

  const constitutionPdf = (name: string, extra: string[] = []) =>
    makeSamplePdf([[...sampleConstitutionLines(name), ...extra].map((text) => ({ text }))]);

  beforeAll(async () => {
    context = await startTestApp({ DOCUMENT_MAX_BYTES: String(MAX_BYTES) });
    a = await createOrg('Riverside Choir (fictional)', 'heron');
    b = await createOrg('Hilltop Club (fictional)', 'baobab');
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('file validation', () => {
    it('refuses unsupported, mislabelled, empty, oversized and unsafe files', async () => {
      const pdf = constitutionPdf('Test');
      const docx = makeSampleDocx([{ text: 'Name', numbered: 0 }]);
      const cases: [string, Buffer, RegExp][] = [
        ['notes.txt', Buffer.from('1. Name'), /Only PDF/],
        ['old.doc', docx, /Older Word files/],
        ['fake.pdf', docx, /not a PDF/],
        ['fake.docx', pdf, /not a Word document/],
        ['page.pdf', Buffer.from('<html><script>alert(1)</script></html>'), /not a PDF/],
        ['empty.pdf', Buffer.alloc(0), /empty/],
        ['macro.docx', makeSampleDocx([{ text: 'x' }], { macroEnabled: true }), /macros/],
        [
          'scripted.pdf',
          Buffer.from(
            pdf
              .toString('latin1')
              .replace('/Type /Catalog', '/Type /Catalog /OpenAction << /S /JavaScript /JS (x) >>'),
            'latin1',
          ),
          /scripts or actions/,
        ],
        ['damaged.pdf', Buffer.from('%PDF-1.7\nthis is not a real pdf'), /could not be opened/],
      ];
      for (const [fileName, content, message] of cases) {
        const response = await upload(a.admin, a, fileName, content);
        expect(response.status, fileName).toBe(400);
        expect(response.body.error.message, fileName).toMatch(message);
      }
      const big = await upload(
        a.admin,
        a,
        'big.pdf',
        Buffer.concat([pdf, Buffer.alloc(MAX_BYTES)]),
      );
      expect(big.status).toBe(413);

      const rejected = await auditEventsFor(context.db, 'document.rejected');
      expect(
        rejected.filter((event) => event.organisationId === a.id).length,
      ).toBeGreaterThanOrEqual(cases.length);
    });

    it('needs the file itself, not a form or JSON, and a file name', async () => {
      await a.admin
        .post(url(a, `/constitutions/${a.ids.constitutionId}/versions`))
        .send({ file: 'x' })
        .expect(400);
      await a.admin
        .post(url(a, `/constitutions/${a.ids.constitutionId}/versions`))
        .set('Content-Type', 'application/pdf')
        .send(constitutionPdf('Test'))
        .expect(400);
    });
  });

  describe('upload, extraction and private storage', () => {
    it('stores the original privately and creates a DRAFT version that members cannot see', async () => {
      const pdf = constitutionPdf('Riverside Choir');
      const response = await upload(a.admin, a, 'Riverside constitution.pdf', pdf, {
        label: 'Amended 2026',
      });
      expect(response.status).toBe(201);
      const version = response.body;
      expect(version).toMatchObject({
        label: 'Amended 2026',
        versionNumber: 3,
        status: 'draft',
        editable: true,
        extraction: { status: 'succeeded', meta: { format: 'pdf', pageCount: 1, sectionCount: 8 } },
        source: {
          fileName: 'Riverside constitution.pdf',
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
        },
      });
      expect(version.sections.map((s: Section) => s.number)).toEqual([
        'Part 1',
        '1',
        '2',
        '(a)',
        '(b)',
        'Part 2',
        '3',
        '4',
      ]);

      // Stored in the organisation's own private folder, marked as a constitution source.
      const [file] = (
        await context.db.execute(
          sql`SELECT storage_key, purpose FROM files WHERE id = ${version.source.id}`,
        )
      ).rows as { storage_key: string; purpose: string }[];
      expect(file!.storage_key.startsWith(`tenants/${a.id}/documents/`)).toBe(true);
      expect(file!.purpose).toBe('constitution_source');

      // Not published automatically: members still see only the old version.
      const library = await a.member.get(url(a, '/library')).expect(200);
      expect(library.body[0].published.versionId).toBe(a.ids.publishedVersionId);
      await a.member.get(url(a, `/versions/${version.id}/sections`)).expect(404);
      await a.member.get(url(a, `/versions/${version.id}/source`)).expect(404);
      await a.member.get(url(a, `/versions/${version.id}/review`)).expect(403);

      for (const action of ['document.uploaded', 'content.extracted']) {
        const events = await auditEventsFor(context.db, action);
        expect(
          events.some((event) => event.targetId === version.id),
          action,
        ).toBe(true);
      }
    });

    it('reads Word documents, including automatic numbering, and warns about tracked changes', async () => {
      const docx = makeSampleDocx(
        [
          { text: 'Constitution', style: 'Title' },
          { text: 'Name', numbered: 0 },
          { text: 'The club is called Riverside Choir.' },
          { text: 'Objectives', numbered: 0 },
          { text: 'to sing together;', numbered: 1 },
          { text: 'to perform for the community.', numbered: 1 },
        ],
        { trackedInsertion: 'Inserted sentence.' },
      );
      const response = await upload(a.reviewer, a, 'constitution.docx', docx);
      expect(response.status).toBe(201);
      expect(response.body.extraction.status).toBe('needs_review');
      expect(
        response.body.extraction.issues.map((issue: { code: string }) => issue.code),
      ).toContain('tracked_changes');
      expect(response.body.sections.map((s: Section) => [s.number, s.heading])).toEqual([
        ['1', 'Name'],
        ['2', 'Objectives'],
        ['(a)', null],
        ['(b)', null],
      ]);
    });

    it('flags uncertain results and marks unreadable documents as failed', async () => {
      const gaps = await upload(
        a.admin,
        a,
        'gaps.pdf',
        makeSamplePdf([
          [
            { text: '1. Name' },
            { text: 'Text one.' },
            { text: '3. Money' },
            { text: 'Text three.' },
          ],
        ]),
      );
      expect(gaps.body.extraction.status).toBe('needs_review');
      const flagged = gaps.body.sections.filter((s: Section) => s.needsReview);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].reviewReason).toMatch(/3 follows 1/);

      const scanned = await upload(a.admin, a, 'scanned.pdf', makeSamplePdf([[], []]));
      expect(scanned.status).toBe(201);
      expect(scanned.body.extraction.status).toBe('failed');
      expect(scanned.body.extraction.issues[0]).toMatchObject({
        code: 'no_text',
        severity: 'error',
      });
      const refused = await a.admin
        .post(url(a, `/versions/${scanned.body.id}/submit`))
        .send({ confirmed: true })
        .expect(409);
      expect(refused.body.error.message).toMatch(/could not be read/);
    });

    it('lets members and auditors upload nothing', async () => {
      for (const agent of [a.member, a.auditor]) {
        const response = await upload(agent, a, 'x.pdf', constitutionPdf('X'));
        expect(response.status).toBe(403);
      }
    });
  });

  describe('review, correction and the approval workflow', () => {
    let versionId: string;
    let sections: Section[];

    beforeAll(async () => {
      const response = await upload(
        a.admin,
        a,
        'new.pdf',
        constitutionPdf('Riverside Choir', [
          '6. Finance',
          'The Treasurer keeps the accounts (heron).',
        ]),
        { label: 'Version with a gap' },
      );
      versionId = response.body.id;
      sections = response.body.sections;
    });

    it('cannot be submitted while flagged sections are unchecked, or without confirmation', async () => {
      const flagged = sections.filter((s) => s.needsReview);
      expect(flagged.map((s) => s.number)).toEqual(['6']);
      await a.reviewer
        .post(url(a, `/versions/${versionId}/submit`))
        .send({})
        .expect(400);
      const blocked = await a.reviewer
        .post(url(a, `/versions/${versionId}/submit`))
        .send({ confirmed: true })
        .expect(409);
      expect(blocked.body.error.message).toMatch(/1 section still needs checking/);
    });

    it('lets reviewers correct the text and mark flagged sections as checked', async () => {
      const finance = sections.find((s) => s.number === '6')!;
      const corrected = await a.reviewer
        .patch(url(a, `/versions/${versionId}/sections/${finance.id}`))
        .send({ number: '5', heading: 'Money matters' })
        .expect(200);
      expect(corrected.body.sections.find((s: Section) => s.id === finance.id)).toMatchObject({
        number: '5',
        heading: 'Money matters',
        needsReview: true,
      });
      await a.reviewer
        .patch(url(a, `/versions/${versionId}/sections/${finance.id}`))
        .send({ heading: 'Bad\u0007heading' })
        .expect(400);
      const resolved = await a.reviewer
        .post(url(a, `/versions/${versionId}/sections/${finance.id}/resolve`))
        .expect(200);
      expect(resolved.body.sectionsNeedingReview).toBe(0);
      for (const action of ['content.section_edited', 'content.flag_resolved']) {
        const events = await auditEventsFor(context.db, action);
        expect(
          events.some((event) => event.targetId === versionId),
          action,
        ).toBe(true);
      }
    });

    it('lets reviewers add and remove sections in a draft', async () => {
      const last = sections[sections.length - 1]!;
      const added = await a.reviewer
        .post(url(a, `/versions/${versionId}/sections`))
        .send({
          afterSectionId: last.id,
          kind: 'clause',
          number: '6',
          heading: 'Dissolution',
          body: 'Remaining money goes to a similar charity.',
        })
        .expect(201);
      const newSection = added.body.sections.find((s: Section) => s.heading === 'Dissolution');
      expect(newSection).toBeDefined();
      const removed = await a.reviewer
        .delete(url(a, `/versions/${versionId}/sections/${newSection.id}`))
        .expect(200);
      expect(removed.body.sections.some((s: Section) => s.heading === 'Dissolution')).toBe(false);
    });

    it('moves to review; reviewers cannot approve, administrators can; approval does not publish', async () => {
      await a.reviewer
        .post(url(a, `/versions/${versionId}/submit`))
        .send({ confirmed: true, comment: 'Checked against the signed copy.' })
        .expect(200);
      // In review: no more editing.
      const finance = sections.find((s) => s.heading === 'Finance')!;
      const locked = await a.admin
        .patch(url(a, `/versions/${versionId}/sections/${finance.id}`))
        .send({ body: 'Sneaky change' })
        .expect(409);
      expect(locked.body.error.message).toMatch(/can no longer be edited/);

      for (const agent of [a.reviewer, a.member, a.auditor]) {
        await agent
          .post(url(a, `/versions/${versionId}/approve`))
          .send({})
          .expect(403);
      }
      const approved = await a.admin
        .post(url(a, `/versions/${versionId}/approve`))
        .send({ comment: 'Approved by the committee.' })
        .expect(200);
      expect(approved.body.status).toBe('approved');

      const library = await a.member.get(url(a, '/library')).expect(200);
      expect(library.body[0].published.versionId).toBe(a.ids.publishedVersionId);
    });

    it('cannot change an approved version, even directly in the database', async () => {
      const finance = sections.find((s) => s.heading === 'Finance')!;
      await a.owner
        .patch(url(a, `/versions/${versionId}/sections/${finance.id}`))
        .send({ body: 'Changed after approval' })
        .expect(409);
      const tenantDb = context.app.get(TenantDatabase);
      const attempt = tenantDb.run(a.scope, (tx) =>
        tx.execute(sql`UPDATE sections SET body = 'tampered' WHERE id = ${finance.id}`),
      );
      await expect(attempt).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/cannot be changed/) }),
      });
      const status = tenantDb.run(a.scope, (tx) =>
        tx.execute(sql`UPDATE constitution_versions SET status = 'draft' WHERE id = ${versionId}`),
      );
      await expect(status).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringMatching(/cannot move from approved to draft/),
        }),
      });
    });

    it('publishes only on an explicit, confirmed step; the previous version is kept as superseded', async () => {
      await a.reviewer
        .post(url(a, `/versions/${versionId}/publish`))
        .send({ confirmed: true })
        .expect(403);
      await a.admin
        .post(url(a, `/versions/${versionId}/publish`))
        .send({})
        .expect(400);
      const published = await a.admin
        .post(url(a, `/versions/${versionId}/publish`))
        .send({ confirmed: true })
        .expect(200);
      expect(published.body.status).toBe('published');

      const library = await a.member.get(url(a, '/library')).expect(200);
      expect(library.body[0].published.versionId).toBe(versionId);
      const search = await a.member.get(url(a, '/search?q=heron')).expect(200);
      expect(
        search.body.results.some((match: { versionId: string }) => match.versionId === versionId),
      ).toBe(true);

      const old = await a.reviewer
        .get(url(a, `/versions/${a.ids.publishedVersionId}/review`))
        .expect(200);
      expect(old.body.status).toBe('superseded');
      expect(old.body.sections.length).toBe(3); // kept unchanged
      expect(old.body.history.map((event: { event: string }) => event.event)).toContain(
        'superseded',
      );

      const history = await a.reviewer
        .get(url(a, `/constitutions/${a.ids.constitutionId}/history`))
        .expect(200);
      const current = history.body.versions.find(
        (version: { id: string }) => version.id === versionId,
      );
      expect(current.history.map((event: { event: string }) => event.event)).toEqual([
        'submitted',
        'approved',
        'published',
      ]);
      expect(current.history[0]).toMatchObject({ comment: 'Checked against the signed copy.' });
      for (const action of ['version.submitted', 'version.approved', 'version.published']) {
        const events = await auditEventsFor(context.db, action);
        expect(
          events.some((event) => event.targetId === versionId),
          action,
        ).toBe(true);
      }
    });

    it('lets members download the original of the current version, as a file', async () => {
      const response = await a.member
        .get(url(a, `/versions/${versionId}/source`))
        .buffer(true)
        .expect(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toMatch(/^attachment; filename="new.pdf"/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('does not archive the current version; can archive others with a reason', async () => {
      await a.admin
        .post(url(a, `/versions/${versionId}/archive`))
        .send({ comment: 'Old one' })
        .expect(409);
      await a.admin
        .post(url(a, `/versions/${a.ids.draftVersionId}/archive`))
        .send({ comment: '' })
        .expect(400);
      const archived = await a.admin
        .post(url(a, `/versions/${a.ids.draftVersionId}/archive`))
        .send({ comment: 'Replaced by the 2026 amendment.' })
        .expect(200);
      expect(archived.body.status).toBe('archived');
    });

    it('sends a version back to draft when changes are requested', async () => {
      const response = await upload(a.admin, a, 'another.pdf', constitutionPdf('Riverside Choir'));
      const id = response.body.id as string;
      await a.admin
        .post(url(a, `/versions/${id}/submit`))
        .send({ confirmed: true })
        .expect(200);
      await a.admin
        .post(url(a, `/versions/${id}/request-changes`))
        .send({})
        .expect(400);
      const back = await a.admin
        .post(url(a, `/versions/${id}/request-changes`))
        .send({ comment: 'Clause 3 wording differs from the signed copy.' })
        .expect(200);
      expect(back.body.status).toBe('draft');
      expect(back.body.history.at(-1)).toMatchObject({
        event: 'changes_requested',
        comment: 'Clause 3 wording differs from the signed copy.',
      });
      // A draft cannot jump straight to published.
      await a.admin
        .post(url(a, `/versions/${id}/publish`))
        .send({ confirmed: true })
        .expect(409);
    });

    it('creates new constitutions for other documents', async () => {
      const created = await a.admin
        .post(url(a, '/constitutions'))
        .send({ title: 'Code of conduct' })
        .expect(201);
      const response = await upload(a.admin, a, 'conduct.pdf', constitutionPdf('Conduct'), {
        constitutionId: created.body.id,
      });
      expect(response.body).toMatchObject({ versionNumber: 1, status: 'draft' });
      await a.member.post(url(a, '/constitutions')).send({ title: 'Not allowed' }).expect(403);
    });
  });

  describe('tenant isolation', () => {
    it("never lets one organisation upload to, read, change or approve another's documents", async () => {
      const own = await upload(b.admin, b, 'b.pdf', constitutionPdf('Hilltop Club'));
      const bVersion = own.body.id as string;
      const bSection = own.body.sections[0].id as string;

      // B's records through A's URL, and B's URL as A's administrator: both "not found".
      expect(
        (
          await upload(a.admin, a, 'x.pdf', constitutionPdf('X'), {
            constitutionId: b.ids.constitutionId,
          })
        ).status,
      ).toBe(404);
      expect((await upload(a.admin, b, 'x.pdf', constitutionPdf('X'))).status).toBe(404);
      for (const org of [a, b]) {
        await a.admin.get(url(org, `/versions/${bVersion}/review`)).expect(404);
        await a.admin.get(url(org, `/versions/${bVersion}/source`)).expect(404);
        await a.admin.get(url(org, `/constitutions/${b.ids.constitutionId}/history`)).expect(404);
        await a.admin
          .patch(url(org, `/versions/${bVersion}/sections/${bSection}`))
          .send({ body: 'x' })
          .expect(404);
        await a.admin
          .post(url(org, `/versions/${bVersion}/sections/${bSection}/resolve`))
          .expect(404);
        await a.admin.delete(url(org, `/versions/${bVersion}/sections/${bSection}`)).expect(404);
        await a.admin
          .post(url(org, `/versions/${bVersion}/submit`))
          .send({ confirmed: true })
          .expect(404);
        await a.owner
          .post(url(org, `/versions/${bVersion}/approve`))
          .send({})
          .expect(404);
        await a.owner
          .post(url(org, `/versions/${bVersion}/publish`))
          .send({ confirmed: true })
          .expect(404);
        await a.owner
          .post(url(org, `/versions/${bVersion}/archive`))
          .send({ comment: 'Taken over' })
          .expect(404);
      }
      // A section of B's version cannot be reached through one of A's versions either.
      await a.admin
        .patch(url(a, `/versions/${a.ids.draftVersionId}/sections/${bSection}`))
        .send({ body: 'x' })
        .expect((response) => expect([404, 409]).toContain(response.status));

      const untouched = await b.admin.get(url(b, `/versions/${bVersion}/review`)).expect(200);
      expect(untouched.body.status).toBe('draft');
      expect(untouched.body.sections[0].body).not.toBe('x');
    });
  });
});
