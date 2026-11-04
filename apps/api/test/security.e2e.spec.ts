// Stage 12: security hardening. Headers, CSRF, general and targeted rate limits, shorter
// Super Admin sessions. Cross-tenant isolation has its own suite (tenancy.e2e.spec.ts), and
// every route's access rule is checked without a database in route-access.spec.ts.
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_PASSWORD,
  client,
  createUser,
  signIn,
  startTestApp,
  uniqueEmail,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

describe.runIf(Boolean(testDatabaseUrl))('security hardening', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
  });

  afterAll(async () => {
    await context?.close();
  });

  describe('response headers', () => {
    it('sends a locked-down policy, no caching and no server details', async () => {
      const response = await request(context.app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(response.headers['x-powered-by']).toBeUndefined();
      // HTTPS-only is only announced once deployed.
      expect(response.headers['strict-transport-security']).toBeUndefined();
    });

    it('does not reflect other websites in CORS answers', async () => {
      const response = await request(context.app.getHttpServer())
        .options('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('cross-site request forgery', () => {
    it('refuses changes without the custom header, or from another website', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('csrf') });
      const agent = await signIn(context, user.email);
      await agent.post('/api/v1/auth/logout').unset('X-Requested-With').expect(403);
      await agent.post('/api/v1/auth/logout').set('Origin', 'https://evil.example').expect(403);
      // Still signed in: neither forged request had any effect.
      await agent.get('/api/v1/auth/me').expect(200);
    });
  });

  describe('general request limit', () => {
    it('slows down one address that sends too many requests, but not health checks', async () => {
      const limited = await startTestApp({ API_RATE_LIMIT_PER_MINUTE: '30' });
      try {
        const server = limited.app.getHttpServer();
        for (let index = 0; index < 30; index += 1) {
          await request(server).get('/api/v1/auth/me').expect(401);
        }
        const blocked = await request(server).get('/api/v1/auth/me').expect(429);
        expect(blocked.body.error.reason).toBe('RATE_LIMITED');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
        await request(server).get('/api/v1/health/live').expect(200);
      } finally {
        await limited.close();
      }
    });
  });

  describe('targeted limits', () => {
    it('stops someone with a stolen session from guessing the current password', async () => {
      const user = await createUser(context.db, { email: uniqueEmail('guess') });
      const agent = await signIn(context, user.email);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await agent
          .post('/api/v1/auth/password/change')
          .send({
            currentPassword: `wrong guess number ${attempt}`,
            newPassword: 'another long passphrase here',
          })
          .expect(400);
      }
      await agent
        .post('/api/v1/auth/password/change')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase here' })
        .expect(429);
    });

    it('limits invitation-link attempts from one address', async () => {
      const limited = await startTestApp({ LOGIN_MAX_ATTEMPTS_PER_IP: '3' });
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await client(limited)
            .post('/api/v1/invitations/accept')
            .send({ token: `not-a-real-invitation-token-${attempt}` })
            .expect((response) => expect(response.status).not.toBe(429));
        }
        const blocked = await client(limited)
          .post('/api/v1/invitations/accept')
          .send({ token: 'not-a-real-invitation-token-x' })
          .expect(429);
        expect(blocked.body.error.reason).toBe('RATE_LIMITED');
      } finally {
        await limited.close();
      }
    });

    it('limits password-reset link attempts from one address', async () => {
      const limited = await startTestApp({ LOGIN_MAX_ATTEMPTS_PER_IP: '2' });
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await client(limited)
            .post('/api/v1/auth/password/reset')
            .send({
              token: `not-a-real-reset-token-${attempt}`,
              newPassword: 'a long new passphrase',
            })
            .expect(400);
        }
        await client(limited)
          .post('/api/v1/auth/password/reset')
          .send({ token: 'not-a-real-reset-token-x', newPassword: 'a long new passphrase' })
          .expect(429);
      } finally {
        await limited.close();
      }
    });
  });

  describe('Super Admin sessions', () => {
    async function ageSession(email: string, minutesIdle: number, hoursOld = 0) {
      await context.db.execute(sql`
        UPDATE sessions SET
          last_seen_at = now() - make_interval(mins => ${minutesIdle}),
          created_at = now() - make_interval(hours => ${hoursOld})
        WHERE user_id = (SELECT id FROM users WHERE email = ${email}) AND revoked_at IS NULL
      `);
    }

    it('end after 30 minutes without activity, while a member’s session continues', async () => {
      const admin = await createUser(context.db, {
        email: uniqueEmail('idle-super'),
        superAdmin: true,
      });
      const member = await createUser(context.db, { email: uniqueEmail('idle-member') });
      const adminAgent = await signIn(context, admin.email);
      const memberAgent = await signIn(context, member.email);
      await ageSession(admin.email, 31);
      await ageSession(member.email, 31);
      await adminAgent.get('/api/v1/auth/me').expect(401);
      await memberAgent.get('/api/v1/auth/me').expect(200);
    });

    it('end after 12 hours even when active', async () => {
      const admin = await createUser(context.db, {
        email: uniqueEmail('old-super'),
        superAdmin: true,
      });
      const agent = await signIn(context, admin.email);
      await ageSession(admin.email, 0, 13);
      await agent.get('/api/v1/auth/me').expect(401);
    });
  });
});
