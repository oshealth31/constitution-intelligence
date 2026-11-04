import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  auditEvents,
  memberships,
  organisations,
  subscriptions,
  userTwoStep,
  users,
  type AuditEvent,
  type Database,
} from '@constitution/db';
import type { OrganisationRole } from '@constitution/shared';
import { hash } from '@node-rs/argon2';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { configureApp } from '../../src/app.factory';
import { AppModule } from '../../src/app.module';
import { loadConfig } from '../../src/config/config';
import { DRIZZLE } from '../../src/database/database.constants';
import { AI_PROVIDER, type AiProvider } from '../../src/modules/ai/ai-provider';
import { MailService } from '../../src/modules/mail/mail.service';
import { generateTotpSecret, totpCode } from '../../src/modules/auth/totp';
import { TwoStepCrypto, developmentOnlyTwoStepKey } from '../../src/modules/auth/two-step-crypto';
import { createTestDatabase, type TestDatabase } from './test-database';

/** Fictional test password. Every test account is created with it, inside throwaway databases. */
export const TEST_PASSWORD = 'correct horse battery staple';

export interface TestContext {
  app: INestApplication;
  db: Database;
  mail: MailService;
  database: TestDatabase;
  close(): Promise<void>;
}

export async function startTestApp(
  overrides: Record<string, string> = {},
  options: { aiProvider?: AiProvider } = {},
): Promise<TestContext> {
  const database = await createTestDatabase();
  const storageDir = mkdtempSync(path.join(tmpdir(), 'ci-storage-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: database.url,
    CORS_ORIGINS: 'http://localhost:3000',
    MAIL_TRANSPORT: 'log',
    // All test requests come from one address; per-address limits get their own test.
    LOGIN_MAX_ATTEMPTS_PER_IP: '10000',
    API_RATE_LIMIT_PER_MINUTE: '1000000',
    // The cleanup timer is tested by calling the service directly.
    CLEANUP_INTERVAL_HOURS: '0',
    STORAGE_LOCAL_DIR: storageDir,
    ...overrides,
  });
  let builder = Test.createTestingModule({ imports: [AppModule.register(config)] });
  if (options.aiProvider) {
    builder = builder.overrideProvider(AI_PROVIDER).useValue(options.aiProvider);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, config);
  await app.init();
  return {
    app,
    db: app.get<Database>(DRIZZLE),
    mail: app.get(MailService),
    database,
    async close() {
      await app.close();
      await database.drop();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

/** A browser-like client that keeps cookies and sends the header our CSRF guard requires. */
export type TestAgent = ReturnType<typeof request.agent>;

export function client(context: TestContext): TestAgent {
  return request.agent(context.app.getHttpServer()).set('X-Requested-With', 'XMLHttpRequest');
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}.${Date.now()}.${counter}@example.test`;
}

/** Authenticator secrets of test accounts with two-step sign-in, by email (this process only). */
const twoStepSecrets = new Map<string, string>();
const testTwoStepCrypto = new TwoStepCrypto(developmentOnlyTwoStepKey());

/** The authenticator secret of a test account created with two-step sign-in. */
export function twoStepSecretFor(email: string): string {
  const secret = twoStepSecrets.get(email);
  if (!secret) throw new Error(`${email} has no two-step sign-in in this test run`);
  return secret;
}

/** Turns two-step sign-in on for a test account directly in the database. Returns the secret. */
export async function enableTwoStep(db: Database, user: { id: string; email: string }) {
  const secret = generateTotpSecret();
  await db
    .insert(userTwoStep)
    .values({
      userId: user.id,
      secretCiphertext: testTwoStepCrypto.encryptSecret(secret, user.id),
      enabledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userTwoStep.userId,
      set: {
        secretCiphertext: testTwoStepCrypto.encryptSecret(secret, user.id),
        enabledAt: new Date(),
        lastUsedStep: null,
      },
    });
  twoStepSecrets.set(user.email, secret);
  return secret;
}

/**
 * Super Admins are created with two-step sign-in already on (it is required for them), so tests
 * about other things can use the Control Centre. Pass `twoStep: false` for one without it.
 */
export async function createUser(
  db: Database,
  options: {
    email?: string;
    displayName?: string;
    password?: string | null;
    superAdmin?: boolean;
    status?: 'active' | 'suspended' | 'deactivated';
    twoStep?: boolean;
  } = {},
) {
  const password = options.password === undefined ? TEST_PASSWORD : options.password;
  const [user] = await db
    .insert(users)
    .values({
      email: options.email ?? uniqueEmail('user'),
      displayName: options.displayName ?? 'Test Person',
      passwordHash: password === null ? null : await hash(password),
      isPlatformSuperAdmin: options.superAdmin ?? false,
      status: options.status ?? 'active',
    })
    .returning();
  if (options.twoStep ?? options.superAdmin ?? false) {
    await enableTwoStep(db, user!);
  }
  return user!;
}

/**
 * A fictional organisation with an active subscription to the "premium" plan (every feature,
 * generous limits), so tests about other things are not affected by subscription rules.
 * Pass `subscription: null` for an organisation with no subscription at all.
 */
export async function createOrganisation(
  db: Database,
  slug = `org-${Date.now()}-${++counter}`,
  options: { subscription?: { planCode: string; status: 'trialing' | 'active' } | null } = {},
) {
  const [organisation] = await db
    .insert(organisations)
    .values({ slug, name: `Fictional Organisation ${counter}` })
    .returning();
  const wanted =
    options.subscription === undefined
      ? { planCode: 'premium', status: 'active' as const }
      : options.subscription;
  if (wanted) {
    const [subscription] = await db
      .insert(subscriptions)
      .values({
        organisationId: organisation!.id,
        planCode: wanted.planCode,
        status: wanted.status,
        billingInterval: wanted.status === 'trialing' ? 'none' : 'monthly',
      })
      .returning({ id: subscriptions.id });
    await db
      .update(organisations)
      .set({ currentSubscriptionId: subscription!.id })
      .where(eq(organisations.id, organisation!.id));
    return { ...organisation!, currentSubscriptionId: subscription!.id };
  }
  return organisation!;
}

export async function addMember(
  db: Database,
  organisationId: string,
  userId: string,
  role: OrganisationRole,
) {
  const [membership] = await db
    .insert(memberships)
    .values({ organisationId, userId, role })
    .returning();
  return membership!;
}

/** Creates a user with the given role in the organisation and returns a signed-in client. */
export async function signedInMember(
  context: TestContext,
  organisationId: string,
  role: OrganisationRole,
) {
  const user = await createUser(context.db, { email: uniqueEmail(role) });
  const membership = await addMember(context.db, organisationId, user.id, role);
  const agent = await signIn(context, user.email);
  return { user, membership, agent };
}

/**
 * Signs in like the web app, including the two-step code for accounts that have it. The
 * "last used code" record is cleared first, so a test may sign the same person in several times
 * within one 30-second step (in real use each code works once).
 */
export async function signIn(context: TestContext, email: string, password = TEST_PASSWORD) {
  const agent = client(context);
  const response = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  const body = response.body as { twoStepRequired?: boolean; challengeToken?: string };
  if (body.twoStepRequired) {
    const [user] = await context.db.select().from(users).where(eq(users.email, email)).limit(1);
    await context.db
      .update(userTwoStep)
      .set({ lastUsedStep: null })
      .where(eq(userTwoStep.userId, user!.id));
    await agent
      .post('/api/v1/auth/login/two-step')
      .send({ challengeToken: body.challengeToken, code: totpCode(twoStepSecretFor(email)) })
      .expect(200);
  }
  return agent;
}

/** Extracts the one-time token from the most recent email sent to `to`. */
export function lastTokenSentTo(context: TestContext, to: string): string {
  const mail = [...context.mail.outbox].reverse().find((message) => message.to === to);
  const match = mail?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) {
    throw new Error(`No token email found for ${to}`);
  }
  return match[1];
}

export async function auditEventsFor(db: Database, action: string): Promise<AuditEvent[]> {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, action))
    .orderBy(desc(auditEvents.occurredAt));
}
