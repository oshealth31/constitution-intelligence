// Control centre (Platform Super Admin) API tests: access is enforced on the server,
// workflows work against the real database, and privileged actions are audited.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleTenantContent, type SampleTenantIds } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  auditEventsFor,
  client,
  createOrganisation,
  createUser,
  signIn,
  signedInMember,
  startTestApp,
  uniqueEmail,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

describe.runIf(Boolean(testDatabaseUrl))('platform control centre', () => {
  let context: TestContext;
  let superAgent: TestAgent;
  let superUserId: string;
  let sample: SampleTenantIds;
  let sampleOwner: TestAgent;
  let sampleAdmin: TestAgent;
  let sampleMember: TestAgent;

  beforeAll(async () => {
    context = await startTestApp();
    const admin = await createUser(context.db, {
      email: uniqueEmail('platform'),
      superAdmin: true,
    });
    superUserId = admin.id;
    superAgent = await signIn(context, admin.email);

    const organisation = await createOrganisation(context.db);
    const owner = await signedInMember(context, organisation.id, 'owner');
    sampleOwner = owner.agent;
    sampleAdmin = (await signedInMember(context, organisation.id, 'admin')).agent;
    sampleMember = (await signedInMember(context, organisation.id, 'member')).agent;
    sample = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisation.id, owner.user.id, 'owner'),
      { name: 'Lakeside Rowing Club (fictional)', uniqueWord: 'heron' },
    );
  });

  afterAll(async () => {
    await context?.close();
  });

  const platformRoutes = (organisationId: string) =>
    [
      ['get', '/api/v1/platform/overview'],
      ['get', '/api/v1/platform/organisations'],
      ['get', `/api/v1/platform/organisations/${organisationId}`],
      ['get', '/api/v1/platform/audit-events'],
      ['get', '/api/v1/platform/support'],
      ['get', '/api/v1/platform/health'],
      ['patch', `/api/v1/platform/organisations/${organisationId}`],
      ['post', `/api/v1/platform/organisations/${organisationId}/status`],
      ['put', `/api/v1/platform/organisations/${organisationId}/subscription`],
      ['post', `/api/v1/platform/organisations/${organisationId}/support-access`],
    ] as const;

  describe('access control', () => {
    it('refuses every control-centre route to organisation owners, administrators and members', async () => {
      for (const agent of [sampleOwner, sampleAdmin, sampleMember]) {
        for (const [method, url] of platformRoutes(sample.organisationId)) {
          const response = await agent[method](url).send({});
          expect(response.status, `${method} ${url}`).toBe(403);
        }
      }
      const denied = await auditEventsFor(context.db, 'permission.denied');
      expect(denied.some((event) => event.metadata.required === 'platform_super_admin')).toBe(true);
    });

    it('refuses anonymous callers', async () => {
      for (const [method, url] of platformRoutes(sample.organisationId)) {
        const response = await client(context)[method](url).send({});
        expect(response.status, `${method} ${url}`).toBe(401);
      }
    });
  });

  describe('overview, health and support', () => {
    it('reports real totals from the database', async () => {
      const response = await superAgent.get('/api/v1/platform/overview').expect(200);
      expect(response.body.totals.organisationsTotal).toBeGreaterThanOrEqual(1);
      expect(response.body.totals.constitutions).toBeGreaterThanOrEqual(1);
      expect(response.body.versionsByStatus).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'published' })]),
      );
      expect(response.body.usage30d).toEqual(
        expect.arrayContaining([expect.objectContaining({ metric: 'ai.questions' })]),
      );
    });

    it('reports system health including database, migrations and storage', async () => {
      const response = await superAgent.get('/api/v1/platform/health').expect(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.checks.database.status).toBe('ok');
      expect(response.body.checks.migrations).toMatchObject({ status: 'ok' });
      expect(response.body.checks.storage.status).toBe('ok');
    });

    it('lists support signals with email addresses masked', async () => {
      const target = uniqueEmail('support-target');
      await client(context)
        .post('/api/v1/auth/login')
        .send({ email: target, password: 'not the right password' })
        .expect(401);
      const response = await superAgent.get('/api/v1/platform/support').expect(200);
      expect(response.body.counts.failedLogins24h).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(response.body)).not.toContain(target);
      expect(
        response.body.recentSecurityEvents.some((event: { targetId: string }) =>
          event.targetId?.endsWith('@example.test'),
        ),
      ).toBe(true);
    });
  });

  describe('organisation management', () => {
    let organisationId: string;

    it('creates an organisation with a trial subscription and onboarding checklist', async () => {
      const slug = `harbour-${Date.now()}`;
      const created = await superAgent
        .post('/api/v1/platform/organisations')
        .send({ name: 'Harbour Lifesaving Club (fictional)', slug })
        .expect(201);
      organisationId = created.body.id;

      const list = await superAgent
        .get(`/api/v1/platform/organisations?search=${slug}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: organisationId,
        status: 'active',
        subscription: { planCode: 'trial', status: 'trialing' },
        onboarding: { completed: 1, total: 7 },
      });
    });

    it('edits the name and slug, refusing a slug that is already taken', async () => {
      const newSlug = `harbour-renamed-${Date.now()}`;
      const updated = await superAgent
        .patch(`/api/v1/platform/organisations/${organisationId}`)
        .send({ name: 'Harbour Lifesaving Club (renamed)', slug: newSlug })
        .expect(200);
      expect(updated.body.organisation).toMatchObject({ slug: newSlug });

      const other = await createOrganisation(context.db);
      await superAgent
        .patch(`/api/v1/platform/organisations/${organisationId}`)
        .send({ slug: other.slug })
        .expect(409);
      const events = await auditEventsFor(context.db, 'organisation.updated');
      expect(events.some((event) => event.organisationId === organisationId)).toBe(true);
    });

    it('configures branding and shows progress in onboarding', async () => {
      const response = await superAgent
        .patch(`/api/v1/platform/organisations/${organisationId}/branding`)
        .send({ tagline: 'Safe waters for everyone', primaryColour: '#123456' })
        .expect(200);
      expect(response.body.branding).toMatchObject({
        tagline: 'Safe waters for everyone',
        primaryColour: '#123456',
      });
      const step = response.body.onboarding.steps.find(
        (s: { key: string }) => s.key === 'branding_configured',
      );
      expect(step.done).toBe(true);
      await superAgent
        .patch(`/api/v1/platform/organisations/${organisationId}/branding`)
        .send({ primaryColour: 'navy' })
        .expect(400);
    });

    it('manages the subscription manually and records before and after', async () => {
      const periodEnd = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const response = await superAgent
        .put(`/api/v1/platform/organisations/${organisationId}/subscription`)
        .send({ planCode: 'standard', status: 'active', currentPeriodEnd: periodEnd })
        .expect(200);
      expect(response.body.subscription).toMatchObject({ planCode: 'standard', status: 'active' });

      await superAgent
        .put(`/api/v1/platform/organisations/${organisationId}/subscription`)
        .send({ planCode: 'standard', status: 'paid-in-full' })
        .expect(400);
      await superAgent
        .put(`/api/v1/platform/organisations/${organisationId}/subscription`)
        .send({ planCode: 'standard', status: 'active', currentPeriodEnd: '2020-01-01T00:00:00Z' })
        .expect(400);

      const events = await auditEventsFor(context.db, 'subscription.updated');
      const event = events.find((e) => e.organisationId === organisationId);
      expect(event?.actorUserId).toBe(superUserId);
      expect(event?.metadata.from).toMatchObject({ planCode: 'trial', status: 'trialing' });
      expect(event?.metadata.to).toMatchObject({ planCode: 'standard', status: 'active' });
    });

    it('suspends an organisation (blocking its members immediately) and reactivates it', async () => {
      const base = `/api/v1/platform/organisations/${sample.organisationId}/status`;
      await superAgent.post(base).send({ status: 'suspended' }).expect(400); // reason required
      const suspended = await superAgent
        .post(base)
        .send({ status: 'suspended', reason: 'Testing suspension of a fictional organisation' })
        .expect(200);
      expect(suspended.body.organisation.status).toBe('suspended');
      await sampleMember.get(`/api/v1/organisations/${sample.organisationId}`).expect(404);
      await sampleOwner
        .get(`/api/v1/organisations/${sample.organisationId}/constitutions`)
        .expect(404);

      await superAgent
        .post(base)
        .send({ status: 'active', reason: 'Test complete, restoring access' })
        .expect(200);
      await sampleMember.get(`/api/v1/organisations/${sample.organisationId}`).expect(200);

      const events = await auditEventsFor(context.db, 'organisation.status_changed');
      expect(
        events.some(
          (event) =>
            event.organisationId === sample.organisationId &&
            event.metadata.reason === 'Testing suspension of a fictional organisation',
        ),
      ).toBe(true);
    });
  });

  describe('administrator management', () => {
    it('invites an administrator, revokes an invitation and manages administrator access', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const base = `/api/v1/platform/organisations/${organisation.id}`;

      const invite = await superAgent
        .post(`${base}/administrator-invitations`)
        .send({ email: uniqueEmail('new-admin'), role: 'admin' })
        .expect(201);
      await superAgent
        .post(`${base}/administrator-invitations`)
        .send({ email: uniqueEmail('member'), role: 'member' })
        .expect(400);
      let detail = await superAgent.get(base).expect(200);
      expect(detail.body.administratorInvitations).toHaveLength(1);
      await superAgent.post(`${base}/invitations/${invite.body.id}/revoke`).expect(204);
      detail = await superAgent.get(base).expect(200);
      expect(detail.body.administratorInvitations).toHaveLength(0);

      // The only active owner cannot be suspended.
      await superAgent
        .patch(`${base}/administrators/${owner.membership.id}`)
        .send({ status: 'suspended' })
        .expect(409);

      const admin = await signedInMember(context, organisation.id, 'admin');
      await superAgent
        .patch(`${base}/administrators/${admin.membership.id}`)
        .send({ status: 'suspended' })
        .expect(200);
      await admin.agent.get(`/api/v1/organisations/${organisation.id}/members`).expect(404);

      // Ordinary members cannot be managed through this route.
      const member = await signedInMember(context, organisation.id, 'member');
      await superAgent
        .patch(`${base}/administrators/${member.membership.id}`)
        .send({ status: 'suspended' })
        .expect(404);
    });
  });

  describe('customer data protection', () => {
    it('shows status and counts but no constitution text or ordinary members’ details', async () => {
      const detail = await superAgent
        .get(`/api/v1/platform/organisations/${sample.organisationId}`)
        .expect(200);
      const text = JSON.stringify(detail.body);
      expect(text).not.toContain('heron'); // a word that only appears in the constitution text
      expect(text).not.toContain('one third of members');
      expect(
        detail.body.administrators.every((a: { role: string }) =>
          ['owner', 'admin'].includes(a.role),
        ),
      ).toBe(true);
      expect(detail.body.memberCounts).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'member', count: 1 })]),
      );
      expect(detail.body.processing.latestVersion).toBeTruthy();
      expect(detail.body.processing.files).toBe(1);
    });

    it('requires a reason to view content, and records the access in the organisation’s own audit log', async () => {
      const url = `/api/v1/platform/organisations/${sample.organisationId}/support-access`;
      await superAgent.post(url).send({}).expect(400);
      await superAgent.post(url).send({ reason: 'short' }).expect(400);

      const response = await superAgent
        .post(url)
        .send({ reason: 'Customer asked us to check clause numbering (ticket 1042)' })
        .expect(200);
      expect(response.body.sections.length).toBeGreaterThan(0);
      // Draft content is never included.
      expect(JSON.stringify(response.body)).not.toContain('herondraft');

      const ownView = await sampleOwner
        .get(`/api/v1/organisations/${sample.organisationId}/audit-events`)
        .expect(200);
      const access = ownView.body.find(
        (event: { action: string }) => event.action === 'support.content_accessed',
      );
      expect(access).toBeDefined();
      expect(access.metadata.reason).toBe(
        'Customer asked us to check clause numbering (ticket 1042)',
      );
      expect(access.actorUserId).toBe(superUserId);
    });
  });

  describe('audit log', () => {
    it('filters events by organisation, action and outcome', async () => {
      const byOrganisation = await superAgent
        .get(`/api/v1/platform/audit-events?organisationId=${sample.organisationId}&limit=200`)
        .expect(200);
      expect(byOrganisation.body.length).toBeGreaterThan(0);
      expect(
        byOrganisation.body.every(
          (e: { organisationId: string }) => e.organisationId === sample.organisationId,
        ),
      ).toBe(true);

      const failures = await superAgent
        .get('/api/v1/platform/audit-events?action=auth.login&outcome=failure')
        .expect(200);
      expect(
        failures.body.every(
          (e: { action: string; outcome: string }) =>
            e.action.startsWith('auth.login') && e.outcome === 'failure',
        ),
      ).toBe(true);

      await superAgent.get('/api/v1/platform/audit-events?organisationId=not-a-uuid').expect(400);
    });
  });
});
