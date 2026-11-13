// The live load test's fictional data tool (cli/load-test-tasks.ts): it creates a working
// fictional organisation, touches nothing else, and cleans up through the normal deletion.
import { organisationDeletionRequests, organisations, users } from '@constitution/db';
import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLoadTestData,
  deleteLoadTestData,
  finishLoadTestData,
} from '../src/cli/load-test-tasks';
import { isLoadTestSlug, loadTestEmail } from '../src/cli/load-test-names';
import {
  client,
  createOrganisation,
  createUser,
  startTestApp,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const PASSWORD = 'fictional-load-test-password-1234';

describe('load test names', () => {
  it('only accepts the addresses the tool creates', () => {
    expect(isLoadTestSlug('load-test-202611132130')).toBe(true);
    for (const slug of ['rbpc', 'load-test-', 'load-test-abc', 'x-load-test-202611132130']) {
      expect(isLoadTestSlug(slug)).toBe(false);
    }
    expect(loadTestEmail('load-test-202611132130', 7)).toBe('load-test-202611132130-7@example.com');
  });
});

describe.runIf(Boolean(testDatabaseUrl))('live load test data', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await startTestApp();
    await createUser(context.db, { superAdmin: true });
  });
  afterAll(async () => {
    await context?.close();
  });

  it('creates a fictional organisation whose members can sign in and read, and cleans up', async () => {
    const real = await createOrganisation(context.db);
    const before = (await context.db.select({ id: users.id }).from(users)).length;

    const created = await createLoadTestData(context.app, 3, PASSWORD);
    expect(isLoadTestSlug(created.slug)).toBe(true);
    expect(created).toMatchObject({ members: 3, sections: 1520 });
    await expect(createLoadTestData(context.app, 3, PASSWORD)).rejects.toThrow(/already exists/);

    // A fictional member signs in and reads the large constitution.
    const agent = client(context);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: loadTestEmail(created.slug, 2), password: PASSWORD })
      .expect(200);
    const org = `/api/v1/organisations/${created.organisationId}`;
    const read = await agent.get(`${org}/versions/${created.versionId}/sections`).expect(200);
    expect(JSON.stringify(read.body)).toContain('Clause 500 heading');
    await agent.get(`${org}/search?q=quorum`).expect(200);

    // Finish: suspended (members blocked) and a deletion request waiting.
    const finished = await finishLoadTestData(context.app);
    expect(finished.finished).toBe(1);
    const [suspended] = await context.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, created.organisationId));
    expect(suspended!.status).toBe('suspended');
    await agent.get(`${org}/versions/${created.versionId}/sections`).expect((response) => {
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    // Deletion waits 24 hours, like every deletion; then it removes the members too.
    await expect(deleteLoadTestData(context.app)).rejects.toThrow();
    await context.db
      .update(organisationDeletionRequests)
      .set({ requestedAt: sql`now() - interval '25 hours'` })
      .where(eq(organisationDeletionRequests.organisationId, created.organisationId));
    expect(await deleteLoadTestData(context.app)).toEqual({ deleted: 1 });
    const left = await context.db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${created.slug}-%`));
    expect(left).toEqual([]);
    expect((await context.db.select({ id: users.id }).from(users)).length).toBe(before);

    // The real organisation was never touched.
    const [untouched] = await context.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, real.id));
    expect(untouched!.status).toBe('active');
    expect(untouched!.deletedAt).toBeNull();
  }, 120_000);
});
