// Task D6: the housekeeping cleanup removes only old sign-in rows, never anything else.
import {
  authRateLimits,
  auditEvents,
  invitations,
  passwordResetTokens,
  sessions,
  twoStepChallenges,
} from '@constitution/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CleanupService } from '../src/modules/maintenance/cleanup.service';
import {
  createOrganisation,
  createUser,
  signIn,
  startTestApp,
  uniqueEmail,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const inDays = (days: number) => new Date(Date.now() + days * DAY);

describe.runIf(Boolean(testDatabaseUrl))('housekeeping cleanup', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
  });
  afterAll(async () => {
    await context?.close();
  });

  it('removes ended sign-in records older than 30 days and keeps everything else', async () => {
    const user = await createUser(context.db, { email: uniqueEmail('cleanup') });
    const organisation = await createOrganisation(context.db);
    const agent = await signIn(context, user.email); // a live session that must survive
    const token = (n: number) => `cleanup-test-token-${Date.now()}-${n}`;

    const old = await context.db
      .insert(sessions)
      .values([
        // expired 31 days ago
        { userId: user.id, tokenHash: token(1), expiresAt: ago(31), createdAt: ago(45), lastSeenAt: ago(40) },
        // signed out 40 days ago
        { userId: user.id, tokenHash: token(2), expiresAt: inDays(1), revokedAt: ago(40), lastSeenAt: ago(40) },
        // idle for more than the idle limit plus 30 days
        { userId: user.id, tokenHash: token(3), expiresAt: inDays(1), lastSeenAt: ago(32) },
      ])
      .returning({ id: sessions.id });
    const recent = await context.db
      .insert(sessions)
      .values([
        // ended 5 days ago: kept for investigations
        { userId: user.id, tokenHash: token(4), expiresAt: ago(5), lastSeenAt: ago(6) },
        { userId: user.id, tokenHash: token(5), expiresAt: inDays(1), revokedAt: ago(5), lastSeenAt: ago(5) },
      ])
      .returning({ id: sessions.id });

    await context.db.insert(passwordResetTokens).values([
      { userId: user.id, tokenHash: token(6), expiresAt: ago(31) },
      { userId: user.id, tokenHash: token(7), expiresAt: inDays(1), usedAt: ago(35) },
      { userId: user.id, tokenHash: token(8), expiresAt: ago(2) },
    ]);
    await context.db.insert(authRateLimits).values([
      { key: `cleanup-old-${Date.now()}`, windowStartedAt: ago(2), attempts: 3 },
      { key: `cleanup-new-${Date.now()}`, windowStartedAt: new Date(), attempts: 1 },
    ]);
    await context.db.insert(twoStepChallenges).values([
      { userId: user.id, tokenHash: token(9), expiresAt: ago(2) },
      { userId: user.id, tokenHash: token(10), expiresAt: inDays(1) },
    ]);
    const [invitation] = await context.db
      .insert(invitations)
      .values({
        organisationId: organisation.id,
        email: uniqueEmail('old-invite'),
        role: 'member',
        tokenHash: token(11),
        expiresAt: ago(90),
      })
      .returning({ id: invitations.id });
    const auditBefore = await context.db.select().from(auditEvents);

    const result = await context.app.get(CleanupService).run();
    expect(result).toMatchObject({ ran: true });
    expect(result.sessions).toBeGreaterThanOrEqual(3);
    expect(result.passwordResetLinks).toBeGreaterThanOrEqual(2);
    expect(result.rateLimitCounters).toBeGreaterThanOrEqual(1);
    expect(result.twoStepChallenges).toBeGreaterThanOrEqual(1);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(
      await context.db.select().from(sessions).where(inArray(sessions.id, ids(old))),
    ).toHaveLength(0);
    expect(
      await context.db.select().from(sessions).where(inArray(sessions.id, ids(recent))),
    ).toHaveLength(2);
    await agent.get('/api/v1/auth/me').expect(200); // the live session still works
    const resets = await context.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));
    expect(resets.map((row) => row.tokenHash)).toEqual([token(8)]);
    const challenges = await context.db
      .select()
      .from(twoStepChallenges)
      .where(eq(twoStepChallenges.userId, user.id));
    expect(challenges.map((row) => row.tokenHash)).toEqual([token(10)]);
    // Never touched: invitations (organisation records) and the audit log.
    expect(
      await context.db.select().from(invitations).where(eq(invitations.id, invitation!.id)),
    ).toHaveLength(1);
    const auditAfter = await context.db.select().from(auditEvents);
    expect(auditAfter.length).toBe(auditBefore.length + 1);
    const recorded = auditAfter.find((event) => event.action === 'maintenance.cleanup');
    expect(recorded?.metadata).toMatchObject({ sessions: result.sessions });

    // Running it again finds nothing more to do.
    const again = await context.app.get(CleanupService).run();
    expect(again).toMatchObject({ ran: true, sessions: 0, passwordResetLinks: 0, twoStepChallenges: 0 });
  });

  it('does nothing while another copy holds the cleanup lock', async () => {
    const service = context.app.get(CleanupService);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // Another "copy of the API" holds the lock in its own transaction.
    const other = context.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7341206)`);
      locked();
      await held;
    });
    await lockTaken;
    expect((await service.run()).ran).toBe(false);
    release();
    await other;
    expect((await service.run()).ran).toBe(true);
  });
});
