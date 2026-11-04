// Task D2: two-step sign-in (authenticator-app codes), through the real API and database.
import {
  sessions,
  twoStepChallenges,
  twoStepRecoveryCodes,
  userTwoStep,
  users,
} from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../src/modules/auth/session.service';
import { timeStep, totpCode } from '../src/modules/auth/totp';
import { TwoStepCrypto, developmentOnlyTwoStepKey } from '../src/modules/auth/two-step-crypto';
import {
  addMember,
  auditEventsFor,
  client,
  createOrganisation,
  createUser,
  enableTwoStep,
  signIn,
  startTestApp,
  TEST_PASSWORD,
  twoStepSecretFor,
  uniqueEmail,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const SESSION_COOKIE = /ci_session=/;

function cookiesOf(response: { headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? value.join(';') : String(value ?? '');
}

describe.runIf(Boolean(testDatabaseUrl))('two-step sign-in', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
  });
  afterAll(async () => {
    await context?.close();
  });

  /** Password step only: returns the agent and the challenge token. */
  async function passwordStep(email: string): Promise<{ agent: TestAgent; challengeToken: string }> {
    const agent = client(context);
    const response = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    expect(response.body.twoStepRequired).toBe(true);
    expect(response.body.user).toBeUndefined();
    expect(cookiesOf(response)).not.toMatch(SESSION_COOKIE);
    return { agent, challengeToken: response.body.challengeToken as string };
  }

  async function clearReplay(userId: string) {
    await context.db
      .update(userTwoStep)
      .set({ lastUsedStep: null })
      .where(eq(userTwoStep.userId, userId));
  }

  /** Sets up two-step sign-in through the API, as the web app does. Returns secret and codes. */
  async function enrolThroughApi(agent: TestAgent) {
    const setup = await agent.post('/api/v1/auth/two-step/setup').expect(200);
    const secret = setup.body.secret as string;
    const confirmed = await agent
      .post('/api/v1/auth/two-step/confirm')
      .send({ code: totpCode(secret) })
      .expect(200);
    return { secret, recoveryCodes: confirmed.body.recoveryCodes as string[], setup: setup.body };
  }

  describe('Super Admins', () => {
    it('can only set it up until it is on; then the Control Centre opens', async () => {
      const admin = await createUser(context.db, {
        email: uniqueEmail('new-super'),
        superAdmin: true,
        twoStep: false,
      });
      const agent = await signIn(context, admin.email); // password only: not set up yet

      const locked = await agent.get('/api/v1/platform/organisations').expect(403);
      expect(locked.body.error.reason).toBe('TWO_STEP_SETUP_REQUIRED');
      const organisation = await createOrganisation(context.db);
      await addMember(context.db, organisation.id, admin.id, 'owner');
      const orgLocked = await agent.get(`/api/v1/organisations/${organisation.id}/members`);
      expect(orgLocked.status).toBe(403);
      expect(orgLocked.body.error.reason).toBe('TWO_STEP_SETUP_REQUIRED');

      const me = await agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.twoStep).toMatchObject({ enabled: false, required: true, available: true });

      const setup = await agent.post('/api/v1/auth/two-step/setup').expect(200);
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(setup.body.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(Buffer.from(setup.body.qrCode.split(',')[1], 'base64').toString()).toContain('<svg');
      // Not on until a code proves the app works.
      await agent.get('/api/v1/platform/organisations').expect(403);

      const wrong = await agent
        .post('/api/v1/auth/two-step/confirm')
        .send({ code: totpCode(setup.body.secret, Date.now() - 5 * 60_000) })
        .expect(400);
      expect(wrong.body.error.message).toMatch(/not right/);

      const confirmed = await agent
        .post('/api/v1/auth/two-step/confirm')
        .send({ code: totpCode(setup.body.secret) })
        .expect(200);
      expect(confirmed.body.recoveryCodes).toHaveLength(10);

      await agent.get('/api/v1/platform/organisations').expect(200);
      const after = await agent.get('/api/v1/auth/me').expect(200);
      expect(after.body.twoStep).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });

      expect((await auditEventsFor(context.db, 'auth.two_step.enabled')).some(
        (event) => event.targetId === admin.id,
      )).toBe(true);
      expect(
        context.mail.outbox.some(
          (mail) => mail.to === admin.email && mail.subject === 'Two-step sign-in is now on',
        ),
      ).toBe(true);
      // Setting it up again is refused while it is on.
      await agent.post('/api/v1/auth/two-step/setup').expect(409);
    });

    it('signs out every other session when it is turned on', async () => {
      const owner = await createUser(context.db, { email: uniqueEmail('owner-others') });
      const organisation = await createOrganisation(context.db);
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const here = await signIn(context, owner.email);
      const elsewhere = await signIn(context, owner.email);
      await enrolThroughApi(here);
      await here.get('/api/v1/auth/me').expect(200);
      await elsewhere.get('/api/v1/auth/me').expect(401);
    });

    it('cannot be turned off by a Super Admin', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-off'), superAdmin: true });
      const agent = await signIn(context, admin.email);
      await clearReplay(admin.id);
      const refused = await agent
        .post('/api/v1/auth/two-step/disable')
        .send({ password: TEST_PASSWORD, code: totpCode(twoStepSecretFor(admin.email)) })
        .expect(403);
      expect(refused.body.error.message).toMatch(/required for Platform Super Admins/);
    });
  });

  describe('signing in', () => {
    it('asks for the code after the password and creates the session only after it', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-in'), superAdmin: true });
      const { agent, challengeToken } = await passwordStep(admin.email);
      await agent.get('/api/v1/auth/me').expect(401);

      const wrong = await agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken, code: '000000' === totpCode(twoStepSecretFor(admin.email)) ? '111111' : '000000' })
        .expect(401);
      expect(wrong.body.error.message).toMatch(/not right/);
      expect(
        (await auditEventsFor(context.db, 'auth.two_step.failed')).some(
          (event) => event.actorUserId === admin.id,
        ),
      ).toBe(true);

      const ok = await agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken, code: totpCode(twoStepSecretFor(admin.email)) })
        .expect(200);
      expect(ok.body.user.email).toBe(admin.email);
      expect(cookiesOf(ok)).toMatch(SESSION_COOKIE);
      await agent.get('/api/v1/platform/organisations').expect(200);

      const succeeded = await auditEventsFor(context.db, 'auth.login.succeeded');
      expect(
        succeeded.some(
          (event) => event.actorUserId === admin.id && event.metadata.twoStep === 'code',
        ),
      ).toBe(true);

      // The waiting sign-in works once only.
      await client(context)
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken, code: totpCode(twoStepSecretFor(admin.email)) })
        .expect(401);
    });

    it('refuses a code that was already used (replay)', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-replay'), superAdmin: true });
      const secret = twoStepSecretFor(admin.email);
      const first = await passwordStep(admin.email);
      const code = totpCode(secret);
      await first.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: first.challengeToken, code })
        .expect(200);
      const second = await passwordStep(admin.email);
      const replayed = await second.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: second.challengeToken, code })
        .expect(401);
      expect(replayed.body.error.message).toMatch(/not right/);
      const [row] = await context.db
        .select({ lastUsedStep: userTwoStep.lastUsedStep })
        .from(userTwoStep)
        .where(eq(userTwoStep.userId, admin.id));
      expect(row!.lastUsedStep).toBeGreaterThanOrEqual(timeStep() - 1);
    });

    it('expires the waiting sign-in after five minutes', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-expiry'), superAdmin: true });
      const { agent, challengeToken } = await passwordStep(admin.email);
      const [challenge] = await context.db
        .select()
        .from(twoStepChallenges)
        .where(eq(twoStepChallenges.userId, admin.id));
      const lifetime = challenge!.expiresAt.getTime() - challenge!.createdAt.getTime();
      expect(lifetime).toBeGreaterThan(4.5 * 60_000);
      expect(lifetime).toBeLessThanOrEqual(5 * 60_000 + 5_000);
      await context.db
        .update(twoStepChallenges)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(twoStepChallenges.id, challenge!.id));
      const expired = await agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken, code: totpCode(twoStepSecretFor(admin.email)) })
        .expect(401);
      expect(expired.body.error.message).toMatch(/expired/);
    });

    it('abandons the waiting sign-in after five wrong codes, and limits wrong codes per person', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-limit'), superAdmin: true });
      const secret = twoStepSecretFor(admin.email);
      const right = () => totpCode(secret);
      const wrongCode = () => (right() === '123456' ? '654321' : '123456');

      const first = await passwordStep(admin.email);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await first.agent
          .post('/api/v1/auth/login/two-step')
          .send({ challengeToken: first.challengeToken, code: wrongCode() })
          .expect(401);
      }
      const fifth = await first.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: first.challengeToken, code: wrongCode() })
        .expect(401);
      expect(fifth.body.error.message).toMatch(/Too many wrong codes/);
      // Even the right code no longer works on that sign-in.
      await first.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: first.challengeToken, code: right() })
        .expect(401);

      // Five more wrong codes on a new sign-in reach the per-person limit (10 in the window).
      const second = await passwordStep(admin.email);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await second.agent
          .post('/api/v1/auth/login/two-step')
          .send({ challengeToken: second.challengeToken, code: wrongCode() })
          .expect(401);
      }
      const third = await passwordStep(admin.email);
      const limited = await third.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: third.challengeToken, code: right() })
        .expect(429);
      expect(limited.body.error.reason).toBe('RATE_LIMITED');
    });

    it('accepts each recovery code once, and tells the person by email', async () => {
      const owner = await createUser(context.db, { email: uniqueEmail('owner-recovery') });
      const organisation = await createOrganisation(context.db);
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const enrolled = await enrolThroughApi(await signIn(context, owner.email));
      const recoveryCode = enrolled.recoveryCodes[0]!;

      const first = await passwordStep(owner.email);
      const ok = await first.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: first.challengeToken, recoveryCode: recoveryCode.toUpperCase() })
        .expect(200);
      expect(ok.body.user.email).toBe(owner.email);
      const me = await first.agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.twoStep.recoveryCodesRemaining).toBe(9);

      const second = await passwordStep(owner.email);
      await second.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: second.challengeToken, recoveryCode })
        .expect(401);

      const used = await auditEventsFor(context.db, 'auth.two_step.recovery_code_used');
      expect(used.some((event) => event.targetId === owner.id)).toBe(true);
      expect(
        context.mail.outbox.some(
          (mail) =>
            mail.to === owner.email &&
            mail.subject === 'A recovery code was used to sign in' &&
            mail.text.includes('9 unused recovery codes'),
        ),
      ).toBe(true);
    });

    it('refuses a session that never passed the second step', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-bypass'), superAdmin: true });
      const created = await context.app
        .get(SessionService)
        .create(admin.id, { ipAddress: null, userAgent: 'test', requestId: null });
      await client(context)
        .get('/api/v1/auth/me')
        .set('Cookie', `ci_session=${created.token}`)
        .expect(401);
    });
  });

  describe('Owners, Administrators and members', () => {
    it('is optional for Owners and Administrators, and not offered to members', async () => {
      const organisation = await createOrganisation(context.db);
      const admin = await createUser(context.db, { email: uniqueEmail('org-admin') });
      await addMember(context.db, organisation.id, admin.id, 'admin');
      const member = await createUser(context.db, { email: uniqueEmail('org-member') });
      await addMember(context.db, organisation.id, member.id, 'member');

      const adminAgent = await signIn(context, admin.email);
      const adminMe = await adminAgent.get('/api/v1/auth/me').expect(200);
      expect(adminMe.body.twoStep).toMatchObject({ enabled: false, required: false, available: true });
      // Without it, Administrators work normally.
      await adminAgent.get(`/api/v1/organisations/${organisation.id}/members`).expect(200);

      const memberAgent = await signIn(context, member.email);
      const memberMe = await memberAgent.get('/api/v1/auth/me').expect(200);
      expect(memberMe.body.twoStep).toMatchObject({ enabled: false, available: false });
      await memberAgent.post('/api/v1/auth/two-step/setup').expect(403);
    });

    it('is turned off only with the password and a current code', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await createUser(context.db, { email: uniqueEmail('owner-disable') });
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const agent = await signIn(context, owner.email);
      const { secret } = await enrolThroughApi(agent);
      await clearReplay(owner.id);

      await agent
        .post('/api/v1/auth/two-step/disable')
        .send({ password: 'not the right password', code: totpCode(secret) })
        .expect(400);
      await agent
        .post('/api/v1/auth/two-step/disable')
        .send({ password: TEST_PASSWORD, code: '000000' === totpCode(secret) ? '111111' : '000000' })
        .expect(400);
      await agent
        .post('/api/v1/auth/two-step/disable')
        .send({ password: TEST_PASSWORD, code: totpCode(secret) })
        .expect(204);

      const after = await signIn(context, owner.email); // password only again
      const me = await after.get('/api/v1/auth/me').expect(200);
      expect(me.body.twoStep.enabled).toBe(false);
      expect(
        await context.db.select().from(twoStepRecoveryCodes).where(eq(twoStepRecoveryCodes.userId, owner.id)),
      ).toHaveLength(0);
      expect((await auditEventsFor(context.db, 'auth.two_step.disabled')).some(
        (event) => event.targetId === owner.id,
      )).toBe(true);
      expect(
        context.mail.outbox.some(
          (mail) => mail.to === owner.email && mail.subject === 'Two-step sign-in has been turned off',
        ),
      ).toBe(true);
    });

    it('gives new recovery codes for a current code, and the old ones stop working', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await createUser(context.db, { email: uniqueEmail('owner-new-codes') });
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const agent = await signIn(context, owner.email);
      const { secret, recoveryCodes: oldCodes } = await enrolThroughApi(agent);
      await clearReplay(owner.id);
      const renewed = await agent
        .post('/api/v1/auth/two-step/recovery-codes')
        .send({ code: totpCode(secret) })
        .expect(200);
      expect(renewed.body.recoveryCodes).toHaveLength(10);
      expect(renewed.body.recoveryCodes).not.toContain(oldCodes[0]);
      const attempt = await passwordStep(owner.email);
      await attempt.agent
        .post('/api/v1/auth/login/two-step')
        .send({ challengeToken: attempt.challengeToken, recoveryCode: oldCodes[0] })
        .expect(401);
    });
  });

  describe('reset (lost phone)', () => {
    it('lets another Super Admin reset it, with a reason, and signs the person out', async () => {
      const resetter = await createUser(context.db, { email: uniqueEmail('super-resetter'), superAdmin: true });
      const organisation = await createOrganisation(context.db);
      const owner = await createUser(context.db, { email: uniqueEmail('owner-lost-phone') });
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const ownerAgent = await signIn(context, owner.email);
      await enrolThroughApi(ownerAgent);

      const superAgent = await signIn(context, resetter.email);
      await superAgent
        .post('/api/v1/platform/two-step/reset')
        .send({ email: owner.email, reason: 'short' })
        .expect(400);
      await superAgent
        .post('/api/v1/platform/two-step/reset')
        .send({ email: resetter.email, reason: 'Testing that nobody can reset their own' })
        .expect(403);
      const reset = await superAgent
        .post('/api/v1/platform/two-step/reset')
        .send({ email: owner.email, reason: 'Lost phone; identity checked by a phone call' })
        .expect(200);
      expect(reset.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

      await ownerAgent.get('/api/v1/auth/me').expect(401);
      const login = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: TEST_PASSWORD })
        .expect(200);
      expect(login.body.user.email).toBe(owner.email); // password only now

      const events = await auditEventsFor(context.db, 'auth.two_step.reset');
      const event = events.find((item) => item.targetId === owner.id);
      expect(event?.actorUserId).toBe(resetter.id);
      expect(event?.metadata.reason).toBe('Lost phone; identity checked by a phone call');
      expect(
        context.mail.outbox.some(
          (mail) => mail.to === owner.email && mail.subject === 'Your two-step sign-in was reset',
        ),
      ).toBe(true);
    });

    it('is refused to anyone who is not a Super Admin', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await createUser(context.db, { email: uniqueEmail('owner-no-reset') });
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const agent = await signIn(context, owner.email);
      await agent
        .post('/api/v1/platform/two-step/reset')
        .send({ email: owner.email, reason: 'Trying to reset without permission' })
        .expect(403);
    });
  });

  describe('data at rest', () => {
    it('stores the secret encrypted and the recovery codes hashed', async () => {
      const organisation = await createOrganisation(context.db);
      const owner = await createUser(context.db, { email: uniqueEmail('owner-at-rest') });
      await addMember(context.db, organisation.id, owner.id, 'owner');
      const { secret, recoveryCodes } = await enrolThroughApi(await signIn(context, owner.email));

      const [row] = await context.db
        .select()
        .from(userTwoStep)
        .where(eq(userTwoStep.userId, owner.id));
      expect(row!.secretCiphertext).not.toContain(secret);
      expect(row!.secretCiphertext.startsWith('v1.')).toBe(true);
      const crypto = new TwoStepCrypto(developmentOnlyTwoStepKey());
      expect(crypto.decryptSecret(row!.secretCiphertext, owner.id)).toBe(secret);

      const codes = await context.db
        .select()
        .from(twoStepRecoveryCodes)
        .where(eq(twoStepRecoveryCodes.userId, owner.id));
      expect(codes).toHaveLength(10);
      for (const code of codes) {
        expect(recoveryCodes.some((plain) => code.codeHash.includes(plain.replace('-', '')))).toBe(
          false,
        );
        expect(code.codeHash).toMatch(/^[0-9a-f]{64}$/);
      }
      // The verified flag is recorded on the session that set it up.
      const verified = await context.db
        .select({ at: sessions.twoStepVerifiedAt })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(users.id, owner.id));
      expect(verified.some((item) => item.at !== null)).toBe(true);
    });

    it('cannot be read by the tenant database role', async () => {
      const admin = await createUser(context.db, { email: uniqueEmail('super-rls'), superAdmin: true });
      await enableTwoStep(context.db, admin);
      await expect(
        context.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE app_tenant`);
          await tx.select().from(userTwoStep);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
