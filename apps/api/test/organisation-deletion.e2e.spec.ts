// Task D3: deleting one organisation's data. Two fictional organisations with full content;
// one is deleted and the other must be completely untouched. Financial records are kept.
import {
  auditEvents,
  invoices,
  memberships,
  organisationDeletionRequests,
  organisations,
  payments,
  subscriptions,
  users,
} from '@constitution/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleTenantContent } from '../src/dev/sample-tenant';
import { FilesService } from '../src/modules/files/files.service';
import { StorageService } from '../src/modules/files/storage.service';
import {
  DELETED_TABLES,
  KEPT_TABLES,
  OrganisationDeletionService,
  SPECIAL_TABLES,
} from '../src/modules/platform/organisation-deletion.service';
import { createTenantScope } from '../src/modules/tenancy/tenant-scope';
import {
  addMember,
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

const REASON = 'Pilot ended; owner asked in writing for deletion (fictional test)';

describe.runIf(Boolean(testDatabaseUrl))('organisation deletion', () => {
  let context: TestContext;
  let firstAdmin: { id: string; email: string };
  let firstAgent: TestAgent;

  beforeAll(async () => {
    context = await startTestApp();
    firstAdmin = await createUser(context.db, {
      email: uniqueEmail('del-super-1'),
      superAdmin: true,
    });
    firstAgent = await signIn(context, firstAdmin.email);
  });
  afterAll(async () => {
    await context?.close();
  });

  const platform = (organisationId: string, rest = '') =>
    `/api/v1/platform/organisations/${organisationId}${rest}`;

  async function tenantWithContent(name: string, uniqueWord: string) {
    const organisation = await createOrganisation(context.db);
    const owner = await signedInMember(context, organisation.id, 'owner');
    const ids = await createSampleTenantContent(
      context.db,
      context.app.get(FilesService),
      createTenantScope(organisation.id, owner.user.id, 'owner'),
      { name, uniqueWord },
    );
    // A financial record that must survive: an invoice and a payment the owner reported.
    const [invoice] = await context.db
      .insert(invoices)
      .values({
        organisationId: organisation.id,
        subscriptionId: ids.subscriptionId,
        number: `INV-2026-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        description: 'Founding pilot (fictional)',
        amountMinor: 150_000,
        currency: 'BWP',
        dueAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await context.db.insert(payments).values({
      organisationId: organisation.id,
      invoiceId: invoice!.id,
      amountMinor: 150_000,
      currency: 'BWP',
      method: 'bank_transfer',
      reference: 'FICTIONAL-REF-1',
      paidOn: '2026-11-01',
      reportedByUserId: owner.user.id,
    });
    const [row] = await context.db
      .select()
      .from(organisations)
      .where(eq(organisations.id, organisation.id));
    return { organisation: row!, owner, ids };
  }

  async function countsFor(organisationId: string, tables: readonly string[]) {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const result = await context.db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE organisation_id = ${organisationId}`,
      );
      counts[table] = (result.rows[0] as { n: number }).n;
    }
    return counts;
  }

  async function suspend(agent: TestAgent, organisationId: string) {
    await agent
      .post(platform(organisationId, '/status'))
      .send({ status: 'suspended', reason: 'Pilot ended (fictional test)' })
      .expect(200);
  }

  async function requestDeletion(agent: TestAgent, organisationId: string, slug: string) {
    const response = await agent
      .post(platform(organisationId, '/deletion-requests'))
      .send({ confirmSlug: slug, reason: REASON, exportConfirmed: true })
      .expect(201);
    return response.body.request.id as string;
  }

  it('lists every table that has an organisation_id as deleted, kept or handled separately', async () => {
    const result = await context.db.execute(sql`
      SELECT DISTINCT table_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organisation_id' ORDER BY 1`);
    const tables = (result.rows as { name: string }[]).map((row) => row.name).sort();
    expect(tables).toEqual([...DELETED_TABLES, ...KEPT_TABLES, ...SPECIAL_TABLES].sort());
  });

  it('refuses an organisation whose access has not ended', async () => {
    const { organisation } = await tenantWithContent('Active Choir (fictional)', 'heron');
    const preview = await firstAgent.get(platform(organisation.id, '/deletion')).expect(200);
    expect(preview.body.eligible).toBe(false);
    const refused = await firstAgent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: organisation.slug, reason: REASON, exportConfirmed: true })
      .expect(409);
    expect(refused.body.error.message).toMatch(/access has ended/);
  });

  it('checks the typed web address and the export confirmation', async () => {
    const { organisation } = await tenantWithContent('Careful Club (fictional)', 'egret');
    await suspend(firstAgent, organisation.id);
    await firstAgent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: 'not-the-address', reason: REASON, exportConfirmed: true })
      .expect(400);
    await firstAgent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: organisation.slug, reason: REASON, exportConfirmed: false })
      .expect(400);
    await firstAgent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: organisation.slug, reason: 'short', exportConfirmed: true })
      .expect(400);
    await requestDeletion(firstAgent, organisation.id, organisation.slug);
    // Only one waiting request at a time.
    await firstAgent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: organisation.slug, reason: REASON, exportConfirmed: true })
      .expect(409);
  });

  it('with one Super Admin: confirmable only after 24 hours, and cancellable before', async () => {
    const { organisation } = await tenantWithContent('Waiting Club (fictional)', 'ibis');
    await suspend(firstAgent, organisation.id);
    const requestId = await requestDeletion(firstAgent, organisation.id, organisation.slug);
    const preview = await firstAgent.get(platform(organisation.id, '/deletion')).expect(200);
    expect(preview.body.rule).toBe('waiting_period');
    expect(preview.body.request.confirmableFrom).toBeTruthy();

    const early = await firstAgent
      .post(platform(organisation.id, `/deletion-requests/${requestId}/approve`))
      .send({ confirmSlug: organisation.slug })
      .expect(409);
    expect(early.body.error.message).toMatch(/24 hours/);

    await firstAgent
      .post(platform(organisation.id, `/deletion-requests/${requestId}/cancel`))
      .expect(200);
    await firstAgent
      .post(platform(organisation.id, `/deletion-requests/${requestId}/approve`))
      .send({ confirmSlug: organisation.slug })
      .expect(404);

    const again = await requestDeletion(firstAgent, organisation.id, organisation.slug);
    await context.db
      .update(organisationDeletionRequests)
      .set({ requestedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(organisationDeletionRequests.id, again));
    const done = await firstAgent
      .post(platform(organisation.id, `/deletion-requests/${again}/approve`))
      .send({ confirmSlug: organisation.slug })
      .expect(200);
    expect(done.body.filesRemoved).toBe(true);
    expect(done.body.preview.organisation.deletedAt).toBeTruthy();
    expect(done.body.preview.lastCompleted.approvalMode).toBe('waiting_period');
  });

  it('refuses an expired request', async () => {
    const { organisation } = await tenantWithContent('Expired Club (fictional)', 'stork');
    await suspend(firstAgent, organisation.id);
    const requestId = await requestDeletion(firstAgent, organisation.id, organisation.slug);
    await context.db
      .update(organisationDeletionRequests)
      .set({
        requestedAt: new Date(Date.now() - 8 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      })
      .where(eq(organisationDeletionRequests.id, requestId));
    const expired = await firstAgent
      .post(platform(organisation.id, `/deletion-requests/${requestId}/approve`))
      .send({ confirmSlug: organisation.slug })
      .expect(409);
    expect(expired.body.error.message).toMatch(/expired/);
    // An expired request does not block a new one.
    await requestDeletion(firstAgent, organisation.id, organisation.slug);
  });

  describe('with two Super Admins', () => {
    let secondAgent: TestAgent;

    beforeAll(async () => {
      const second = await createUser(context.db, {
        email: uniqueEmail('del-super-2'),
        superAdmin: true,
      });
      secondAgent = await signIn(context, second.email);
    });

    it('needs a different Super Admin, deletes everything of one organisation and nothing of the other', async () => {
      const a = await tenantWithContent('Deleted Fellowship (fictional)', 'kingfisher');
      const b = await tenantWithContent('Untouched Netball Club (fictional)', 'baobab');
      // Someone in both organisations keeps their account; someone only in A loses theirs.
      const shared = await createUser(context.db, { email: uniqueEmail('in-both') });
      await addMember(context.db, a.organisation.id, shared.id, 'member');
      await addMember(context.db, b.organisation.id, shared.id, 'member');
      const ownerEmail = a.owner.user.email;
      const storage = context.app.get(StorageService);
      expect(await storage.organisationFolderExists(a.organisation.id)).toBe(true);

      const bBefore = await countsFor(b.organisation.id, [
        ...DELETED_TABLES,
        ...KEPT_TABLES,
        'audit_events',
      ]);
      const aKeptBefore = await countsFor(a.organisation.id, KEPT_TABLES);
      const aBefore = await countsFor(a.organisation.id, DELETED_TABLES);
      const openSubscriptionsBefore = (
        await context.db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.organisationId, a.organisation.id))
      ).filter((subscription) => subscription.status !== 'cancelled').length;
      expect(openSubscriptionsBefore).toBeGreaterThan(0);
      expect(aBefore.sections).toBeGreaterThan(0);
      expect(aBefore.files).toBeGreaterThan(0);

      await suspend(firstAgent, a.organisation.id);
      const preview = await firstAgent.get(platform(a.organisation.id, '/deletion')).expect(200);
      expect(preview.body).toMatchObject({
        eligible: true,
        rule: 'second_person',
        accountsToDelete: 1,
        accountsKept: 1,
      });
      expect(preview.body.willDelete.sections).toBe(aBefore.sections);
      expect(preview.body.financialRecordsKept.invoices).toBe(1);

      const requestId = await requestDeletion(firstAgent, a.organisation.id, a.organisation.slug);
      const self = await firstAgent
        .post(platform(a.organisation.id, `/deletion-requests/${requestId}/approve`))
        .send({ confirmSlug: a.organisation.slug })
        .expect(403);
      expect(self.body.error.message).toMatch(/different Super Admin/);
      await secondAgent
        .post(platform(a.organisation.id, `/deletion-requests/${requestId}/approve`))
        .send({ confirmSlug: 'wrong-address' })
        .expect(400);
      const done = await secondAgent
        .post(platform(a.organisation.id, `/deletion-requests/${requestId}/approve`))
        .send({ confirmSlug: a.organisation.slug })
        .expect(200);
      expect(done.body.filesRemoved).toBe(true);

      // A: every organisation record gone; financial records kept.
      const aAfter = await countsFor(a.organisation.id, DELETED_TABLES);
      expect(Object.values(aAfter).every((count) => count === 0)).toBe(true);
      // Kept, plus one subscription-history entry per subscription the deletion ended.
      expect(await countsFor(a.organisation.id, KEPT_TABLES)).toEqual({
        ...aKeptBefore,
        subscription_events: aKeptBefore.subscription_events! + openSubscriptionsBefore,
      });
      const ended = await context.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organisationId, a.organisation.id));
      expect(ended.length).toBeGreaterThan(0);
      for (const subscription of ended) {
        expect(subscription).toMatchObject({ status: 'cancelled', autoRenew: false });
        expect(subscription.cancellationReason).toMatch(/data was deleted/);
      }
      const billing = await firstAgent.get(platform(a.organisation.id, '/billing')).expect(200);
      expect(billing.body.organisation.deletedAt).toBeTruthy();
      // Nothing can renew or be invoiced; existing invoices can still be settled or voided.
      for (const [path, body] of [
        ['/subscription/renew', {}],
        ['/subscription/reactivate', { reason: 'Trying to restart it (fictional)' }],
        ['/subscription/suspend', { reason: 'Trying to suspend it (fictional)' }],
        [
          '/invoices',
          {
            description: 'Late invoice (fictional)',
            amountMinor: 1000,
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      ] as const) {
        const refused = await firstAgent.post(platform(a.organisation.id, path)).send(body);
        expect(refused.status, path).toBe(409);
      }
      const [keptInvoice] = await context.db
        .select()
        .from(invoices)
        .where(eq(invoices.organisationId, a.organisation.id));
      await firstAgent
        .post(platform(a.organisation.id, `/invoices/${keptInvoice!.id}/void`))
        .send({ reason: 'Pilot ended before payment (fictional)' })
        .expect(200);
      const [payment] = await context.db
        .select()
        .from(payments)
        .where(eq(payments.organisationId, a.organisation.id));
      expect(payment!.reportedByUserId).toBeNull();

      // The marker row: deleted, archived, web address freed.
      const [marker] = await context.db
        .select()
        .from(organisations)
        .where(eq(organisations.id, a.organisation.id));
      expect(marker!.deletedAt).not.toBeNull();
      expect(marker!.status).toBe('archived');
      expect(marker!.slug).toMatch(/^deleted-[0-9a-f]{12}$/);
      await client(context).get(`/api/v1/portal/${a.organisation.slug}`).expect(404);

      // A's audit log: only the deletion record remains, with counts and no names or emails.
      const events = await context.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organisationId, a.organisation.id));
      // (plus the invoice voided above, after the deletion: financial actions are still recorded).
      expect(events.map((event) => event.action).sort()).toEqual([
        'invoice.voided',
        'organisation.deleted',
      ]);
      const deletionEvent = events.find((event) => event.action === 'organisation.deleted')!;
      expect(JSON.stringify(deletionEvent)).not.toContain(ownerEmail);
      expect(deletionEvent.metadata).toMatchObject({ approvalMode: 'second_person', reason: REASON });

      // Accounts: A's owner deleted with their sign-in events; shared member and staff kept.
      expect(
        await context.db.select().from(users).where(eq(users.id, a.owner.user.id)),
      ).toHaveLength(0);
      const ownerEvents = await context.db
        .select()
        .from(auditEvents)
        .where(
          and(isNull(auditEvents.organisationId), eq(auditEvents.actorUserId, a.owner.user.id)),
        );
      expect(ownerEvents).toHaveLength(0);
      await a.owner.agent.get('/api/v1/auth/me').expect(401);
      const sharedMemberships = await context.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, shared.id));
      expect(sharedMemberships.map((item) => item.organisationId)).toEqual([b.organisation.id]);

      // Files gone from storage for A only.
      expect(await storage.organisationFolderExists(a.organisation.id)).toBe(false);
      expect(await storage.organisationFolderExists(b.organisation.id)).toBe(true);

      // B untouched, and still works.
      const bAfter = await countsFor(b.organisation.id, [
        ...DELETED_TABLES,
        ...KEPT_TABLES,
        'audit_events',
      ]);
      expect(bAfter).toEqual(bBefore);
      await b.owner.agent
        .get(`/api/v1/organisations/${b.organisation.id}/constitutions`)
        .expect(200);

      // A deleted organisation cannot be changed or brought back.
      await firstAgent
        .post(platform(a.organisation.id, '/status'))
        .send({ status: 'active', reason: 'Trying to bring it back (fictional)' })
        .expect(409);
      await firstAgent
        .post(platform(a.organisation.id, '/owner-invitations'))
        .send({ email: uniqueEmail('late-owner') })
        .expect(409);
      await firstAgent
        .post(platform(a.organisation.id, '/deletion-requests'))
        .send({ confirmSlug: marker!.slug, reason: REASON, exportConfirmed: true })
        .expect(409);
    });
  });

  it('from the command line: only after 24 hours', async () => {
    const { organisation } = await tenantWithContent('Command Line Club (fictional)', 'plover');
    await suspend(firstAgent, organisation.id);
    const requestId = await requestDeletion(firstAgent, organisation.id, organisation.slug);
    const service = context.app.get(OrganisationDeletionService);
    const meta = { ipAddress: null, userAgent: 'cli', requestId: null };
    await expect(
      service.approve(organisation.id, requestId, organisation.slug, null, meta),
    ).rejects.toThrow(/24 hours/);
    await context.db
      .update(organisationDeletionRequests)
      .set({ requestedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(organisationDeletionRequests.id, requestId));
    const result = await service.approve(organisation.id, requestId, organisation.slug, null, meta);
    expect(result.preview.lastCompleted?.approvalMode).toBe('command_line');
  });

  it('keeps the audit log append-only outside an approved deletion', async () => {
    const { organisation, owner } = await tenantWithContent('Protected Club (fictional)', 'crane');
    // An event of this organisation, so each attempt below has a row to try to change.
    await context.db.insert(auditEvents).values({
      action: 'organisation.updated',
      outcome: 'success',
      organisationId: organisation.id,
      actorUserId: owner.user.id,
    });
    const attempts = [
      // Naming an organisation that is not deleted.
      sql`SELECT set_config('app.deleting_organisation_id', ${organisation.id}, true)`,
      // Naming a person whose account still exists.
      sql`SELECT set_config('app.deleting_user_id', ${owner.user.id}, true)`,
    ];
    for (const setting of attempts) {
      let message = 'no error';
      try {
        await context.db.transaction(async (tx) => {
          await tx.execute(setting);
          await tx.execute(
            sql`DELETE FROM audit_events WHERE organisation_id = ${organisation.id} OR actor_user_id = ${owner.user.id}::uuid`,
          );
        });
      } catch (error) {
        const cause = (error as { cause?: { message?: string } }).cause;
        message = cause?.message ?? (error as Error).message;
      }
      expect(message).toMatch(/append-only/);
    }
    let updateMessage = 'no error';
    try {
      await context.db.execute(
        sql`UPDATE audit_events SET action = 'x' WHERE organisation_id = ${organisation.id}`,
      );
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause;
      updateMessage = cause?.message ?? (error as Error).message;
    }
    expect(updateMessage).toMatch(/append-only/);
  });

  it('is only for Super Admins', async () => {
    const { organisation, owner } = await tenantWithContent('Own Club (fictional)', 'swift');
    await owner.agent.get(platform(organisation.id, '/deletion')).expect(403);
    await owner.agent
      .post(platform(organisation.id, '/deletion-requests'))
      .send({ confirmSlug: organisation.slug, reason: REASON, exportConfirmed: true })
      .expect(403);
  });
});
