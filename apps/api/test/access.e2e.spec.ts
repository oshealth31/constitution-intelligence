import { invitations } from '@constitution/db';
import { ORGANISATION_ROLES, type OrganisationRole } from '@constitution/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  auditEventsFor,
  client,
  createOrganisation,
  createUser,
  lastTokenSentTo,
  signIn,
  signedInMember,
  startTestApp,
  uniqueEmail,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const NEW_MEMBER_PASSWORD = 'a fictional new member passphrase';

describe.runIf(Boolean(testDatabaseUrl))('access control', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('platform super admin', () => {
    it('creates an organisation and invites its first owner, who joins by invitation', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super'), superAdmin: true });
      const superAgent = await signIn(context, admin.email);

      const created = await superAgent
        .post('/api/v1/platform/organisations')
        .send({ name: 'Fictional Tennis Association', slug: `tennis-${Date.now()}` })
        .expect(201);
      const organisationId = created.body.id as string;

      const ownerEmail = uniqueEmail('first-owner');
      const invitation = await superAgent
        .post(`/api/v1/platform/organisations/${organisationId}/owner-invitations`)
        .send({ email: ownerEmail })
        .expect(201);
      expect(invitation.body).toMatchObject({
        email: ownerEmail,
        role: 'owner',
        status: 'pending',
      });
      expect(JSON.stringify(invitation.body)).not.toMatch(/token/i);

      const newOwner = client(context);
      await newOwner
        .post('/api/v1/invitations/accept')
        .send({
          token: lastTokenSentTo(context, ownerEmail),
          displayName: 'Fictional Owner',
          password: NEW_MEMBER_PASSWORD,
        })
        .expect(200);
      const me = await newOwner.get('/api/v1/auth/me').expect(200);
      expect(me.body.memberships).toEqual([
        expect.objectContaining({ organisationId, role: 'owner' }),
      ]);

      const audited = await auditEventsFor(context.db, 'organisation.created');
      expect(audited.some((event) => event.organisationId === organisationId)).toBe(true);
    });

    it('does not give the super admin automatic access to organisation data', async () => {
      const organisation = await createOrganisation(context.db);
      const admin = await createUser(context.db, {
        email: uniqueEmail('super2'),
        superAdmin: true,
      });
      const superAgent = await signIn(context, admin.email);
      await superAgent.get(`/api/v1/organisations/${organisation.id}/members`).expect(404);
    });

    it('refuses platform endpoints to everyone else and records the attempt', async () => {
      const organisation = await createOrganisation(context.db);
      const { agent, user } = await signedInMember(context, organisation.id, 'owner');
      await agent.get('/api/v1/platform/organisations').expect(403);
      await agent
        .post('/api/v1/platform/organisations')
        .send({ name: 'Sneaky Org', slug: `sneaky-${Date.now()}` })
        .expect(403);

      const denied = await auditEventsFor(context.db, 'permission.denied');
      expect(denied.some((event) => event.actorUserId === user.id)).toBe(true);
    });

    it('suspends a user account and immediately ends their sessions', async () => {
      const admin = await createUser(context.db, {
        email: uniqueEmail('super3'),
        superAdmin: true,
      });
      const superAgent = await signIn(context, admin.email);
      const target = await createUser(context.db, { email: uniqueEmail('target') });
      const targetAgent = await signIn(context, target.email);

      await superAgent
        .patch(`/api/v1/platform/users/${target.id}/status`)
        .send({ status: 'suspended' })
        .expect(200);
      await targetAgent.get('/api/v1/auth/me').expect(401);
      await superAgent
        .patch(`/api/v1/platform/users/${admin.id}/status`)
        .send({ status: 'suspended' })
        .expect(403);
    });
  });

  describe('role permissions on the server', () => {
    let organisationId: string;
    const agents = {} as Record<OrganisationRole, TestAgent>;

    beforeAll(async () => {
      organisationId = (await createOrganisation(context.db)).id;
      for (const role of ORGANISATION_ROLES) {
        agents[role] = (await signedInMember(context, organisationId, role)).agent;
      }
    });

    const expectations: [string, (role: OrganisationRole) => boolean][] = [
      ['GET organisation', () => true],
      ['GET members', (role) => ['owner', 'admin', 'auditor'].includes(role)],
      ['GET audit-events', (role) => ['owner', 'admin', 'auditor'].includes(role)],
      ['POST invitations', (role) => ['owner', 'admin'].includes(role)],
    ];

    for (const [action, allowed] of expectations) {
      for (const role of ORGANISATION_ROLES) {
        it(`${action}: ${role} is ${allowed(role) ? 'allowed' : 'refused'}`, async () => {
          const base = `/api/v1/organisations/${organisationId}`;
          let response;
          if (action === 'GET organisation') response = await agents[role].get(base);
          else if (action === 'GET members') response = await agents[role].get(`${base}/members`);
          else if (action === 'GET audit-events')
            response = await agents[role].get(`${base}/audit-events`);
          else
            response = await agents[role]
              .post(`${base}/invitations`)
              .send({ email: uniqueEmail(`invitee-${role}`), role: 'member' });
          expect(response.status).toBe(
            allowed(role) ? (action.startsWith('POST') ? 201 : 200) : 403,
          );
        });
      }
    }

    it('keeps the auditor read-only for member changes', async () => {
      const base = `/api/v1/organisations/${organisationId}`;
      const members = await agents.auditor.get(`${base}/members`).expect(200);
      const someone = (members.body as { membershipId: string; role: string }[]).find(
        (member) => member.role === 'member',
      );
      await agents.auditor
        .patch(`${base}/members/${someone!.membershipId}`)
        .send({ role: 'admin' })
        .expect(403);
      await agents.auditor.delete(`${base}/members/${someone!.membershipId}`).expect(403);
    });

    it('refuses anonymous callers on organisation routes', async () => {
      await client(context).get(`/api/v1/organisations/${organisationId}`).expect(401);
    });
  });

  describe('privilege escalation is prevented', () => {
    it('stops an administrator from inviting an owner, but allows lower roles', async () => {
      const organisation = await createOrganisation(context.db);
      const { agent } = await signedInMember(context, organisation.id, 'admin');
      const base = `/api/v1/organisations/${organisation.id}/invitations`;
      await agent
        .post(base)
        .send({ email: uniqueEmail('wannabe'), role: 'owner' })
        .expect(403);
      await agent
        .post(base)
        .send({ email: uniqueEmail('peer'), role: 'admin' })
        .expect(201);
      await agent
        .post(base)
        .send({ email: uniqueEmail('aud'), role: 'auditor' })
        .expect(201);
    });

    it('stops an administrator from changing an owner or promoting anyone to owner', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const admin = await signedInMember(context, organisation.id, 'admin');
      const member = await signedInMember(context, organisation.id, 'member');
      const base = `/api/v1/organisations/${organisation.id}/members`;

      await admin.agent
        .patch(`${base}/${owner.membership.id}`)
        .send({ role: 'member' })
        .expect(403);
      await admin.agent.delete(`${base}/${owner.membership.id}`).expect(403);
      await admin.agent
        .patch(`${base}/${member.membership.id}`)
        .send({ role: 'owner' })
        .expect(403);
      await admin.agent.patch(`${base}/${admin.membership.id}`).send({ role: 'owner' }).expect(403);

      // Allowed: an administrator changes a member to auditor.
      await admin.agent
        .patch(`${base}/${member.membership.id}`)
        .send({ role: 'auditor' })
        .expect(204);
      const changes = await auditEventsFor(context.db, 'membership.role_changed');
      expect(
        changes.some(
          (event) =>
            event.targetId === member.membership.id &&
            event.metadata.from === 'member' &&
            event.metadata.to === 'auditor',
        ),
      ).toBe(true);
    });

    it('stops anyone changing or removing their own membership', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const base = `/api/v1/organisations/${organisation.id}/members/${owner.membership.id}`;
      await owner.agent.patch(base).send({ role: 'member' }).expect(403);
      await owner.agent.delete(base).expect(403);
    });

    it('cannot be bypassed by sending role data the API does not accept', async () => {
      const organisation = await createOrganisation(context.db);
      const { agent } = await signedInMember(context, organisation.id, 'admin');
      await agent
        .post(`/api/v1/organisations/${organisation.id}/invitations`)
        .send({ email: uniqueEmail('x'), role: 'platform_super_admin' })
        .expect(400);
    });

    it('lets an owner suspend a member, which immediately removes their access', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const member = await signedInMember(context, organisation.id, 'member');
      await member.agent.get(`/api/v1/organisations/${organisation.id}`).expect(200);
      await owner.agent
        .patch(`/api/v1/organisations/${organisation.id}/members/${member.membership.id}`)
        .send({ status: 'suspended' })
        .expect(204);
      await member.agent.get(`/api/v1/organisations/${organisation.id}`).expect(404);
    });
  });

  describe('organisations are isolated from each other', () => {
    it('hides other organisations and their members from an administrator', async () => {
      const mine = await createOrganisation(context.db);
      const theirs = await createOrganisation(context.db);
      const admin = await signedInMember(context, mine.id, 'admin');
      const victimUser = await createUser(context.db, { email: uniqueEmail('victim') });
      const victim = await addMember(context.db, theirs.id, victimUser.id, 'member');

      await admin.agent.get(`/api/v1/organisations/${theirs.id}`).expect(404);
      await admin.agent.get(`/api/v1/organisations/${theirs.id}/members`).expect(404);
      // Using their own organisation's URL with the other organisation's membership ID:
      await admin.agent
        .patch(`/api/v1/organisations/${mine.id}/members/${victim.id}`)
        .send({ role: 'auditor' })
        .expect(404);
      await admin.agent.delete(`/api/v1/organisations/${mine.id}/members/${victim.id}`).expect(404);
      await admin.agent.get('/api/v1/organisations/not-a-uuid').expect(404);
    });

    it('shows each organisation only its own audit events', async () => {
      const first = await createOrganisation(context.db);
      const second = await createOrganisation(context.db);
      const firstOwner = await signedInMember(context, first.id, 'owner');
      const secondOwner = await signedInMember(context, second.id, 'owner');
      await secondOwner.agent
        .post(`/api/v1/organisations/${second.id}/invitations`)
        .send({ email: uniqueEmail('second-org'), role: 'member' })
        .expect(201);

      const events = await firstOwner.agent
        .get(`/api/v1/organisations/${first.id}/audit-events`)
        .expect(200);
      expect(
        (events.body as { organisationId: string }[]).every(
          (event) => event.organisationId === first.id,
        ),
      ).toBe(true);
    });
  });

  describe('invitations', () => {
    it('requires an existing account holder to sign in, then adds the membership', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const existing = await createUser(context.db, { email: uniqueEmail('existing') });
      await owner.agent
        .post(`/api/v1/organisations/${organisation.id}/invitations`)
        .send({ email: existing.email, role: 'content_reviewer' })
        .expect(201);
      const token = lastTokenSentTo(context, existing.email);

      await client(context)
        .post('/api/v1/invitations/accept')
        .send({ token, displayName: 'Impostor', password: NEW_MEMBER_PASSWORD })
        .expect(401);

      const agent = await signIn(context, existing.email);
      await agent.post('/api/v1/invitations/accept').send({ token }).expect(200);
      const me = await agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.memberships).toEqual([
        expect.objectContaining({ organisationId: organisation.id, role: 'content_reviewer' }),
      ]);

      // Used once only.
      await agent.post('/api/v1/invitations/accept').send({ token }).expect(400);
    });

    it('refuses an invitation accepted by a different signed-in person', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const invitedEmail = uniqueEmail('intended');
      await owner.agent
        .post(`/api/v1/organisations/${organisation.id}/invitations`)
        .send({ email: invitedEmail, role: 'member' })
        .expect(201);
      const someoneElse = await createUser(context.db, { email: uniqueEmail('other') });
      const otherAgent = await signIn(context, someoneElse.email);
      await otherAgent
        .post('/api/v1/invitations/accept')
        .send({ token: lastTokenSentTo(context, invitedEmail) })
        .expect(403);
    });

    it('refuses revoked and expired invitations, and weak passwords for new accounts', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const base = `/api/v1/organisations/${organisation.id}/invitations`;

      const revokedEmail = uniqueEmail('revoked');
      const revoked = await owner.agent.post(base).send({ email: revokedEmail, role: 'member' });
      await owner.agent.post(`${base}/${revoked.body.id}/revoke`).expect(204);
      await client(context)
        .post('/api/v1/invitations/accept')
        .send({
          token: lastTokenSentTo(context, revokedEmail),
          displayName: 'Revoked Person',
          password: NEW_MEMBER_PASSWORD,
        })
        .expect(400);

      const expiredEmail = uniqueEmail('expired-invite');
      const expired = await owner.agent.post(base).send({ email: expiredEmail, role: 'member' });
      await context.db.execute(
        sql`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${expired.body.id}`,
      );
      await client(context)
        .post('/api/v1/invitations/accept')
        .send({
          token: lastTokenSentTo(context, expiredEmail),
          displayName: 'Late Person',
          password: NEW_MEMBER_PASSWORD,
        })
        .expect(400);

      const weakEmail = uniqueEmail('weak');
      await owner.agent.post(base).send({ email: weakEmail, role: 'member' }).expect(201);
      const weak = await client(context)
        .post('/api/v1/invitations/accept')
        .send({
          token: lastTokenSentTo(context, weakEmail),
          displayName: 'Weak',
          password: 'short',
        })
        .expect(400);
      expect(weak.body.error.message).toMatch(/at least 12/);
    });

    it('stores only a hash of the invitation token', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await signedInMember(context, organisation.id, 'owner');
      const email = uniqueEmail('hashed');
      const created = await owner.agent
        .post(`/api/v1/organisations/${organisation.id}/invitations`)
        .send({ email, role: 'member' })
        .expect(201);
      const [row] = await context.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, created.body.id as string));
      expect(row?.tokenHash).not.toBe(lastTokenSentTo(context, email));
    });
  });

  describe('audit log', () => {
    it('cannot be edited or deleted, even directly in the database', async () => {
      // The database's own message is carried in the driver error's "cause".
      const databaseMessage = async (statement: Promise<unknown>) => {
        try {
          await statement;
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause;
          return cause?.message ?? (error as Error).message;
        }
        return 'no error';
      };
      const before = await context.db.execute(sql`SELECT count(*)::int AS n FROM audit_events`);
      expect(Number((before.rows[0] as { n: number }).n)).toBeGreaterThan(0);

      expect(
        await databaseMessage(context.db.execute(sql`UPDATE audit_events SET action = 'tampered'`)),
      ).toMatch(/append-only/);
      expect(await databaseMessage(context.db.execute(sql`DELETE FROM audit_events`))).toMatch(
        /append-only/,
      );
      expect(await databaseMessage(context.db.execute(sql`TRUNCATE audit_events`))).toMatch(
        /append-only/,
      );
    });
  });
});
