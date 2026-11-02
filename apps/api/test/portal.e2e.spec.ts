// Organisation portals: public branding, branded portal home, logo safety, library, reading,
// content status, portal address changes and profile updates, with organisation separation.
import { organisations } from '@constitution/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_BRANDING, applySampleBranding, makeSampleLogoPng } from '../src/dev/sample-branding';
import { createSampleTenantContent, type SampleTenantIds } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  auditEventsFor,
  createOrganisation,
  signedInMember,
  startTestApp,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

interface PortalTenant {
  id: string;
  slug: string;
  ids: SampleTenantIds;
  owner: TestAgent;
  admin: TestAgent;
  reviewer: TestAgent;
  member: TestAgent;
  auditor: TestAgent;
}

const base64 = (content: Buffer | string) => Buffer.from(content).toString('base64');

describe.runIf(Boolean(testDatabaseUrl))('organisation portals', () => {
  let context: TestContext;
  let a: PortalTenant;
  let b: PortalTenant;
  let run = 0;

  async function createPortalTenant(
    variant: 'choir' | 'netball',
    uniqueWord: string,
  ): Promise<PortalTenant> {
    run += 1;
    const slug = `portal-${variant}-${Date.now()}-${run}`;
    const organisation = await createOrganisation(context.db, slug);
    const owner = await signedInMember(context, organisation.id, 'owner');
    const ids = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisation.id, owner.user.id, 'owner'),
      { name: SAMPLE_BRANDING[variant].displayName, uniqueWord },
    );
    await applySampleBranding(context.db, organisation.id, SAMPLE_BRANDING[variant]);
    return {
      id: organisation.id,
      slug,
      ids,
      owner: owner.agent,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      reviewer: (await signedInMember(context, organisation.id, 'content_reviewer')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
      auditor: (await signedInMember(context, organisation.id, 'auditor')).agent,
    };
  }

  const orgUrl = (tenant: PortalTenant, path = '') =>
    `/api/v1/organisations/${tenant.id}${path}`;

  beforeAll(async () => {
    context = await startTestApp();
    a = await createPortalTenant('choir', 'nightingale');
    b = await createPortalTenant('netball', 'kingfisher');
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('public portal information (before signing in)', () => {
    it('shows only what a branded sign-in page needs', async () => {
      const response = await a.member.get(`/api/v1/portal/${a.slug}`).expect(200);
      expect(Object.keys(response.body).sort()).toEqual(
        ['available', 'colours', 'logoUrl', 'name', 'slug', 'tagline'].sort(),
      );
      expect(response.body).toMatchObject({
        slug: a.slug,
        name: SAMPLE_BRANDING.choir.displayName,
        available: true,
        colours: {
          primary: SAMPLE_BRANDING.choir.primaryColour,
          secondary: SAMPLE_BRANDING.choir.secondaryColour,
          accent: SAMPLE_BRANDING.choir.accentColour,
        },
      });
      // No IDs, members, content or welcome message are revealed publicly.
      expect(JSON.stringify(response.body)).not.toContain(a.id);
      expect(JSON.stringify(response.body)).not.toContain('Welcome');
    });

    it('answers "not found" for unknown or malformed addresses', async () => {
      await a.member.get('/api/v1/portal/no-such-portal-here').expect(404);
      await a.member.get('/api/v1/portal/..%2Fadmin').expect(404);
      await a.member.get('/api/v1/portal/x').expect(404);
    });

    it('marks suspended portals unavailable and hides archived ones', async () => {
      const slug = `portal-status-${Date.now()}`;
      const organisation = await createOrganisation(context.db, slug);
      await context.db
        .update(organisations)
        .set({ status: 'suspended' })
        .where(eq(organisations.id, organisation.id));
      const suspended = await a.member.get(`/api/v1/portal/${slug}`).expect(200);
      expect(suspended.body.available).toBe(false);
      await context.db
        .update(organisations)
        .set({ status: 'archived' })
        .where(eq(organisations.id, organisation.id));
      await a.member.get(`/api/v1/portal/${slug}`).expect(404);
    });
  });

  describe('branded portal home', () => {
    it('gives each organisation its own branding from the same code', async () => {
      const homeA = await a.member.get(orgUrl(a, '/portal')).expect(200);
      const homeB = await b.member.get(orgUrl(b, '/portal')).expect(200);
      expect(homeA.body.organisation).toMatchObject({
        slug: a.slug,
        name: SAMPLE_BRANDING.choir.displayName,
        welcomeMessage: SAMPLE_BRANDING.choir.welcomeMessage,
        colours: { primary: SAMPLE_BRANDING.choir.primaryColour },
      });
      expect(homeB.body.organisation).toMatchObject({
        slug: b.slug,
        name: SAMPLE_BRANDING.netball.displayName,
        colours: { primary: SAMPLE_BRANDING.netball.primaryColour },
      });
      expect(homeA.body.organisation.colours.primary).not.toBe(
        homeB.body.organisation.colours.primary,
      );
      expect(homeA.body.you).toMatchObject({ role: 'member', roleLabel: 'Organisation Member' });
      expect(homeA.body.you.permissions).toEqual(['organisation.read', 'constitution.read']);
      expect(homeA.body.library).toMatchObject({ constitutions: 1, published: 1 });
    });

    it("refuses another organisation's portal, revealing nothing", async () => {
      for (const agent of [a.member, a.admin, a.owner]) {
        const response = await agent.get(orgUrl(b, '/portal')).expect(404);
        expect(JSON.stringify(response.body)).not.toContain(SAMPLE_BRANDING.netball.displayName);
      }
    });

    it('requires signing in', async () => {
      await request(context.app.getHttpServer()).get(orgUrl(a, '/portal')).expect(401);
    });
  });

  describe('branding changes', () => {
    it('lets administrators change branding, but not members, reviewers or auditors', async () => {
      for (const agent of [a.member, a.reviewer, a.auditor]) {
        await agent.patch(orgUrl(a, '/branding')).send({ accentColour: '#000000' }).expect(403);
      }
      const response = await a.admin
        .patch(orgUrl(a, '/branding'))
        .send({ secondaryColour: '#fafafa', welcomeMessage: 'Hello members.\nSecond line.' })
        .expect(200);
      expect(response.body).toMatchObject({
        secondaryColour: '#FAFAFA',
        welcomeMessage: 'Hello members.\nSecond line.',
      });
      const events = await auditEventsFor(context.db, 'organisation.branding_updated');
      expect(events.some((event) => event.organisationId === a.id)).toBe(true);
    });

    it('refuses colours that are not exact colour codes', async () => {
      for (const primaryColour of [
        'red',
        '#12345',
        '#1234567',
        '#0B1F3A; background: url(https://evil.test/x)',
        'expression(alert(1))',
        'var(--x)',
      ]) {
        await a.admin.patch(orgUrl(a, '/branding')).send({ primaryColour }).expect(400);
      }
    });

    it('refuses hidden control characters and multi-line names', async () => {
      await a.admin
        .patch(orgUrl(a, '/branding'))
        .send({ welcomeMessage: 'Hello\u0007there' })
        .expect(400);
      await a.admin
        .patch(orgUrl(a, '/branding'))
        .send({ displayName: 'Choir\nInjected line' })
        .expect(400);
    });

    it('stores HTML-like text as plain text (the portal shows it as text, never runs it)', async () => {
      const payload = '<script>alert("x")</script><img src=x onerror=alert(1)>';
      const response = await a.admin
        .patch(orgUrl(a, '/branding'))
        .send({ welcomeMessage: payload })
        .expect(200);
      expect(response.body.welcomeMessage).toBe(payload);
    });

    it('cannot change another organisation, even with its ID in the body', async () => {
      await a.admin.patch(orgUrl(b, '/branding')).send({ accentColour: '#000000' }).expect(404);
      await a.admin
        .patch(orgUrl(a, '/branding'))
        .send({ accentColour: '#123456', organisationId: b.id })
        .expect(200);
      const home = await b.member.get(orgUrl(b, '/portal')).expect(200);
      expect(home.body.organisation.colours.accent).toBe(SAMPLE_BRANDING.netball.accentColour);
    });
  });

  describe('logos', () => {
    const png = makeSampleLogoPng('#4A2B6B', '#D9A21B');

    it('accepts a real PNG and serves it safely', async () => {
      const response = await a.admin
        .put(orgUrl(a, '/branding/logo'))
        .send({ fileName: 'logo.png', dataBase64: base64(png) })
        .expect(200);
      expect(response.body.logoFileId).toEqual(expect.any(String));

      const portal = await a.member.get(`/api/v1/portal/${a.slug}`).expect(200);
      expect(portal.body.logoUrl).toBe(`/api/v1/portal/${a.slug}/logo?v=${response.body.logoFileId}`);
      const logo = await a.member.get(portal.body.logoUrl).buffer(true).expect(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['x-content-type-options']).toBe('nosniff');
      expect(logo.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(logo.body as Buffer, png)).toBe(0);
    });

    it('refuses SVG, HTML and other files, whatever they are called', async () => {
      const attempts = [
        { fileName: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' },
        { fileName: 'logo.png', content: '<html><script>alert(1)</script></html>' },
        { fileName: 'logo.gif', content: 'GIF89a\u0001\u0000\u0001\u0000' },
      ];
      for (const attempt of attempts) {
        const response = await a.admin
          .put(orgUrl(a, '/branding/logo'))
          .send({ fileName: attempt.fileName, dataBase64: base64(attempt.content) })
          .expect(400);
        expect(response.body.error.message).toContain('PNG, JPEG or WebP');
      }
      const rejected = await auditEventsFor(context.db, 'organisation.logo_rejected');
      expect(rejected.filter((event) => event.organisationId === a.id).length).toBeGreaterThanOrEqual(3);
    });

    it('refuses logos over 512 KB', async () => {
      const large = Buffer.concat([png.subarray(0, 8), Buffer.alloc(600 * 1024)]);
      await a.admin
        .put(orgUrl(a, '/branding/logo'))
        .send({ fileName: 'big.png', dataBase64: base64(large) })
        .expect(400);
    });

    it('only administrators of the same organisation can change the logo', async () => {
      await a.member
        .put(orgUrl(a, '/branding/logo'))
        .send({ fileName: 'logo.png', dataBase64: base64(png) })
        .expect(403);
      await a.admin
        .put(orgUrl(b, '/branding/logo'))
        .send({ fileName: 'logo.png', dataBase64: base64(png) })
        .expect(404);
      await a.admin.delete(orgUrl(b, '/branding/logo')).expect(404);
    });

    it('removes the logo', async () => {
      const response = await a.admin.delete(orgUrl(a, '/branding/logo')).expect(200);
      expect(response.body.logoFileId).toBeNull();
      const portal = await a.member.get(`/api/v1/portal/${a.slug}`).expect(200);
      expect(portal.body.logoUrl).toBeNull();
      await a.member.get(`/api/v1/portal/${a.slug}/logo`).expect(404);
    });
  });

  describe('library, reading and search', () => {
    it('shows members published constitutions only', async () => {
      const library = await a.member.get(orgUrl(a, '/library')).expect(200);
      expect(library.body).toHaveLength(1);
      expect(library.body[0]).toMatchObject({
        id: a.ids.constitutionId,
        published: { versionId: a.ids.publishedVersionId, sectionCount: 3 },
      });
      expect(library.body[0]).not.toHaveProperty('versionsInProgress');

      const reviewerView = await a.reviewer.get(orgUrl(a, '/library')).expect(200);
      expect(reviewerView.body[0].versionsInProgress).toBe(1);

      const constitution = await a.member
        .get(orgUrl(a, `/constitutions/${a.ids.constitutionId}`))
        .expect(200);
      expect(constitution.body.versions.map((v: { status: string }) => v.status)).toEqual([
        'published',
      ]);
      await a.member.get(orgUrl(a, `/versions/${a.ids.draftVersionId}/sections`)).expect(404);
    });

    it("never shows another organisation's constitution", async () => {
      await a.member.get(orgUrl(a, `/constitutions/${b.ids.constitutionId}`)).expect(404);
      await a.member.get(orgUrl(b, `/constitutions/${b.ids.constitutionId}`)).expect(404);
      await a.member.get(orgUrl(b, '/library')).expect(404);
      const library = await a.owner.get(orgUrl(a, '/library')).expect(200);
      expect(JSON.stringify(library.body)).not.toContain(b.ids.constitutionId);
    });

    it('links search results to their constitution', async () => {
      const response = await a.member.get(orgUrl(a, '/search?q=quorum')).expect(200);
      expect(response.body.length).toBeGreaterThan(0);
      for (const match of response.body) {
        expect(match.constitutionId).toBe(a.ids.constitutionId);
        expect(match.constitutionTitle).toContain(SAMPLE_BRANDING.choir.displayName);
      }
      const other = await a.member.get(orgUrl(a, '/search?q=kingfisher')).expect(200);
      expect(other.body).toEqual([]);
    });
  });

  describe('content approval status', () => {
    it('is visible to reviewers, administrators and owners only', async () => {
      for (const agent of [a.member, a.auditor]) {
        await agent.get(orgUrl(a, '/content-status')).expect(403);
      }
      for (const agent of [a.reviewer, a.admin, a.owner]) {
        await agent.get(orgUrl(a, '/content-status')).expect(200);
      }
      await a.reviewer.get(orgUrl(b, '/content-status')).expect(404);
    });

    it('lists every version with its status and latest decision', async () => {
      const response = await a.reviewer.get(orgUrl(a, '/content-status')).expect(200);
      expect(response.body).toHaveLength(1);
      const versions = response.body[0].versions as {
        id: string;
        status: string;
        latestDecision: { decision: string; reviewerName: string | null } | null;
      }[];
      expect(versions.map((version) => version.status)).toEqual(['draft', 'published']);
      const published = versions.find((version) => version.id === a.ids.publishedVersionId)!;
      expect(published.latestDecision).toMatchObject({
        decision: 'approved',
        reviewerName: 'Test Person',
      });
      expect(JSON.stringify(response.body)).not.toContain(b.ids.publishedVersionId);
    });
  });

  describe('portal address (slug)', () => {
    it('can be changed by the owner only, and never to a reserved or taken address', async () => {
      const tenant = await createPortalTenant('choir', 'skylark');
      await tenant.admin
        .patch(orgUrl(tenant, '/settings'))
        .send({ slug: 'new-address-1' })
        .expect(403);
      await tenant.owner.patch(orgUrl(tenant, '/settings')).send({ slug: 'admin' }).expect(400);
      await tenant.owner.patch(orgUrl(tenant, '/settings')).send({ slug: 'Bad Address' }).expect(400);
      await tenant.owner.patch(orgUrl(tenant, '/settings')).send({ slug: b.slug }).expect(409);
      await a.owner.patch(orgUrl(tenant, '/settings')).send({ slug: 'stolen-address' }).expect(404);

      const newSlug = `renamed-${Date.now()}`;
      await tenant.owner.patch(orgUrl(tenant, '/settings')).send({ slug: newSlug }).expect(200);
      await tenant.member.get(`/api/v1/portal/${tenant.slug}`).expect(404);
      await tenant.member.get(`/api/v1/portal/${newSlug}`).expect(200);
      const events = await auditEventsFor(context.db, 'organisation.slug_changed');
      expect(events.find((event) => event.organisationId === tenant.id)?.metadata).toMatchObject({
        from: tenant.slug,
        to: newSlug,
      });
    });
  });

  describe('profile', () => {
    it('lets people change their own display name only', async () => {
      const response = await a.member
        .patch('/api/v1/auth/me')
        .send({ displayName: 'Mpho Sample', email: 'changed@example.test', isPlatformSuperAdmin: true })
        .expect(200);
      expect(response.body.user).toMatchObject({
        displayName: 'Mpho Sample',
        isPlatformSuperAdmin: false,
      });
      expect(response.body.user.email).not.toBe('changed@example.test');
      await a.member.patch('/api/v1/auth/me').send({ displayName: '' }).expect(400);
      await a.member.patch('/api/v1/auth/me').send({ displayName: 'Bad\u0000name' }).expect(400);
      const events = await auditEventsFor(context.db, 'user.profile_updated');
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
