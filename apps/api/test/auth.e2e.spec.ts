import { sessions, users } from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  auditEventsFor,
  client,
  createUser,
  lastTokenSentTo,
  signIn,
  startTestApp,
  uniqueEmail,
  type TestContext,
} from './support/test-app';
import { maskEmail } from '../src/modules/auth/auth.service';
import { testDatabaseUrl } from './support/test-database';

const NEW_PASSWORD = 'a brand new passphrase for testing';

describe.runIf(Boolean(testDatabaseUrl))('authentication', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('sign-in', () => {
    it('signs in with the right password and sets a secure session cookie', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('login') });
      const response = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
        .expect(200);

      expect(response.body.user).toMatchObject({ id: user.id, email: user.email });
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toMatch(/ci_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(JSON.stringify(response.body)).not.toMatch(/password|hash/i);

      const events = await auditEventsFor(context.db, 'auth.login.succeeded');
      expect(events.some((event) => event.actorUserId === user.id)).toBe(true);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('wrongpw') });
      const wrongPassword = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'not the right password' })
        .expect(401);
      const unknownAddress = uniqueEmail('nobody');
      const unknownEmail = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: unknownAddress, password: 'not the right password' })
        .expect(401);

      expect(wrongPassword.body.error.message).toBe('Invalid email or password.');
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();

      const failures = await auditEventsFor(context.db, 'auth.login.failed');
      expect(failures.some((event) => event.targetId === user.email)).toBe(true);
      expect(JSON.stringify(failures)).not.toContain('not the right password');
      // An address with no account is only kept masked (it may be a mistyped password).
      expect(JSON.stringify(failures)).not.toContain(unknownAddress);
      expect(failures.some((event) => event.targetId === maskEmail(unknownAddress))).toBe(true);
    });

    it('refuses suspended and deactivated accounts even with the right password', async () => {
      for (const status of ['suspended', 'deactivated'] as const) {
        const user = await createUser(context.db, { email: uniqueEmail(status), status });
        await client(context)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: TEST_PASSWORD })
          .expect(403);
      }
    });

    it('rejects malformed input without echoing it back', async () => {
      const response = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(400);
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^email:/),
          expect.stringMatching(/^password:/),
        ]),
      );
    });
  });

  describe('sessions', () => {
    it('lets a signed-in user see who they are, and refuses anonymous callers', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('me') });
      const agent = await signIn(context, user.email);
      const me = await agent.get('/api/v1/auth/me').expect(200);
      expect(me.body.user).toMatchObject({ id: user.id, isPlatformSuperAdmin: false });
      expect(me.body.memberships).toEqual([]);

      const anonymous = await request(context.app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
      expect(anonymous.body.error.code).toBe('UNAUTHORIZED');
    });

    it('ends the session on sign-out so the old cookie stops working', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('logout') });
      const server = context.app.getHttpServer();
      const login = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;

      await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      const logout = await request(server)
        .post('/api/v1/auth/logout')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', cookie)
        .expect(204);
      expect(String(logout.headers['set-cookie'])).toMatch(/ci_session=;/);
      // Replaying the old cookie value is refused: the session was ended on the server.
      await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('signs out every device with logout-all', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('logoutall') });
      const phone = await signIn(context, user.email);
      const laptop = await signIn(context, user.email);
      await phone.post('/api/v1/auth/logout-all').expect(204);
      await laptop.get('/api/v1/auth/me').expect(401);
    });

    it('expires sessions after the idle timeout', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('idle') });
      const agent = await signIn(context, user.email);
      await context.db
        .update(sessions)
        .set({ lastSeenAt: new Date(Date.now() - 2 * 24 * 3_600_000) })
        .where(eq(sessions.userId, user.id));
      await agent.get('/api/v1/auth/me').expect(401);
    });

    it('immediately cuts off a user whose account is suspended', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('cutoff') });
      const agent = await signIn(context, user.email);
      await context.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));
      await agent.get('/api/v1/auth/me').expect(401);
    });

    it('stores only a hash of the session token', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('hashonly') });
      const response = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const token = String(response.headers['set-cookie']).match(/ci_session=([^;]+)/)?.[1];
      const stored = await context.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(token).toBeDefined();
      expect(stored[0]?.tokenHash).not.toBe(token);
      expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('CSRF protection', () => {
    it('refuses state-changing requests without the required header or from other origins', async () => {
      const server = context.app.getHttpServer();
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('csrf'), password: TEST_PASSWORD })
        .expect(403);
      await request(server)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Origin', 'https://evil.example')
        .send({ email: uniqueEmail('csrf'), password: TEST_PASSWORD })
        .expect(403);
    });
  });

  describe('brute-force protection', () => {
    it('blocks further attempts on an account after 5 tries, even with the right password', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('brute') });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await client(context)
          .post('/api/v1/auth/login')
          .send({ email: user.email, password: `wrong guess ${attempt}` })
          .expect(401);
      }
      const blocked = await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');

      const events = await auditEventsFor(context.db, 'auth.login.rate_limited');
      expect(events.some((event) => event.targetId === maskEmail(user.email))).toBe(true);
    });

    it('limits attempts from one network address across many accounts', async () => {
      const limited = await startTestApp({ LOGIN_MAX_ATTEMPTS_PER_IP: '3' });
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await client(limited)
            .post('/api/v1/auth/login')
            .send({ email: uniqueEmail('spray'), password: 'guessing passwords' })
            .expect(401);
        }
        await client(limited)
          .post('/api/v1/auth/login')
          .send({ email: uniqueEmail('spray'), password: 'guessing passwords' })
          .expect(429);
      } finally {
        await limited.close();
      }
    });
  });

  describe('password reset', () => {
    it('resets the password with a one-time link and signs out existing sessions', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('reset') });
      const oldSession = await signIn(context, user.email);

      const forgot = await client(context)
        .post('/api/v1/auth/password/forgot')
        .send({ email: user.email })
        .expect(202);
      expect(forgot.body.message).toMatch(/If an account exists/);
      const token = lastTokenSentTo(context, user.email);

      await client(context)
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      await oldSession.get('/api/v1/auth/me').expect(401);
      await client(context)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
      await signIn(context, user.email, NEW_PASSWORD);

      // The link works only once.
      await client(context)
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'yet another long passphrase' })
        .expect(400);
    });

    it('answers identically for unknown emails and sends nothing', async () => {
      const email = uniqueEmail('ghost');
      const response = await client(context)
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      expect(response.body.message).toMatch(/If an account exists/);
      expect(context.mail.outbox.some((mail) => mail.to === email)).toBe(false);
    });

    it('rejects expired links and weak new passwords', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('expired') });
      await client(context).post('/api/v1/auth/password/forgot').send({ email: user.email });
      const token = lastTokenSentTo(context, user.email);

      const weak = await client(context)
        .post('/api/v1/auth/password/reset')
        .send({ token, newPassword: 'short' })
        .expect(400);
      expect(weak.body.error.message).toMatch(/at least 12/);

      const expiring = await startTestApp({ PASSWORD_RESET_TTL_MINUTES: '5' });
      try {
        const other = await createUser(expiring.db, { email: uniqueEmail('expiring') });
        await client(expiring).post('/api/v1/auth/password/forgot').send({ email: other.email });
        const expiredToken = lastTokenSentTo(expiring, other.email);
        // Move the token's expiry into the past.
        await expiring.db.execute(
          sql`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`,
        );
        await client(expiring)
          .post('/api/v1/auth/password/reset')
          .send({ token: expiredToken, newPassword: NEW_PASSWORD })
          .expect(400);
      } finally {
        await expiring.close();
      }
    });

    it('lets a signed-in user change their password and signs out their other devices', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('change') });
      const current = await signIn(context, user.email);
      const other = await signIn(context, user.email);

      await current
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: 'wrong current password', newPassword: NEW_PASSWORD })
        .expect(400);
      await current
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);

      await current.get('/api/v1/auth/me').expect(200);
      await other.get('/api/v1/auth/me').expect(401);
      const events = await auditEventsFor(context.db, 'auth.password.changed');
      expect(events.some((event) => event.actorUserId === user.id)).toBe(true);
    });
  });
});
