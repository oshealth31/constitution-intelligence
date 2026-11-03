// Stage 10: subscription states and the access restrictions the API enforces for them, plan
// features, usage limits, the manual payment workflow (no payment provider, no card details,
// nothing marked paid without a person verifying it), and Super Admin-only controls.
import { invoices, organisations, payments, plans, subscriptions } from '@constitution/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEventsFor,
  createOrganisation,
  createUser,
  signedInMember,
  signIn,
  startTestApp,
  type TestAgent,
  type TestContext,
} from './support/test-app';
import { testDatabaseUrl } from './support/test-database';

const DAY = 86_400_000;

interface Org {
  id: string;
  owner: TestAgent;
  admin: TestAgent;
  member: TestAgent;
}

describe.runIf(Boolean(testDatabaseUrl))('Subscriptions and entitlements', () => {
  let context: TestContext;
  let superAgent: TestAgent;

  beforeAll(async () => {
    context = await startTestApp();
    const admin = await createUser(context.db, {
      email: 'billing-super@example.test',
      superAdmin: true,
    });
    superAgent = await signIn(context, admin.email);
  });

  afterAll(async () => {
    await context?.close();
  });

  async function makeOrg(
    planCode = 'premium',
    status: 'trialing' | 'active' = 'active',
  ): Promise<Org> {
    const organisation = await createOrganisation(context.db, undefined, {
      subscription: { planCode, status },
    });
    return {
      id: organisation.id,
      owner: (await signedInMember(context, organisation.id, 'owner')).agent,
      admin: (await signedInMember(context, organisation.id, 'admin')).agent,
      member: (await signedInMember(context, organisation.id, 'member')).agent,
    };
  }

  const url = (org: Org, path = '') => `/api/v1/organisations/${org.id}${path}`;
  const platform = (org: Org, path: string) => `/api/v1/platform/organisations/${org.id}${path}`;

  /** Moves the current subscription's dates (to test what happens as time passes). */
  async function setPeriod(org: Org, start: Date, end: Date | null) {
    const [row] = await context.db.select().from(organisations).where(eq(organisations.id, org.id));
    await context.db
      .update(subscriptions)
      .set({ currentPeriodStart: start, currentPeriodEnd: end })
      .where(eq(subscriptions.id, row!.currentSubscriptionId!));
  }

  async function state(org: Org) {
    return (await org.owner.get(url(org, '/billing')).expect(200)).body.access as {
      state: string;
      paymentStatus: string;
      message: string;
      dataRetainedUntil: string | null;
    };
  }

  describe('subscription states and access restrictions', () => {
    it('an active subscription gives every role normal access', async () => {
      const org = await makeOrg();
      expect((await state(org)).state).toBe('active');
      await org.member.get(url(org, '/library')).expect(200);
      await org.admin.post(url(org, '/constitutions')).send({ title: 'Rules' }).expect(201);
    });

    it('a pilot works, and is shown as a pilot', async () => {
      const org = await makeOrg('trial', 'trialing');
      expect((await state(org)).state).toBe('pilot');
      await org.member.get(url(org, '/library')).expect(200);
    });

    it('during the grace period everything still works, with a warning', async () => {
      const org = await makeOrg();
      await setPeriod(org, new Date(Date.now() - 40 * DAY), new Date(Date.now() - 2 * DAY));
      const access = await state(org);
      expect(access.state).toBe('grace');
      expect(access.message).toContain('Payment or renewal is needed by');
      await org.member.get(url(org, '/library')).expect(200);
      await org.admin.post(url(org, '/constitutions')).send({ title: 'Rules' }).expect(201);
      const home = await org.member.get(url(org, '/portal')).expect(200);
      expect(home.body.subscription).toMatchObject({ state: 'grace', fullAccess: true });
    });

    it('after the grace period: members are blocked, admins can only read, nothing can change', async () => {
      const org = await makeOrg();
      await setPeriod(org, new Date(Date.now() - 60 * DAY), new Date(Date.now() - 30 * DAY));
      const access = await state(org);
      expect(access.state).toBe('restricted');
      expect(access.dataRetainedUntil).not.toBeNull();

      const blocked = await org.member.get(url(org, '/library')).expect(403);
      expect(blocked.body.error.reason).toBe('SUBSCRIPTION_READ_ONLY');
      await org.admin.get(url(org, '/library')).expect(200);
      await org.owner.get(url(org, '/library')).expect(200);
      const write = await org.admin
        .post(url(org, '/constitutions'))
        .send({ title: 'Rules' })
        .expect(403);
      expect(write.body.error.reason).toBe('SUBSCRIPTION_READ_ONLY');
      await org.owner
        .post(url(org, '/invitations'))
        .send({ email: 'new@example.test', role: 'member' })
        .expect(403);

      // Members are told why; owners can still see billing.
      const home = await org.member.get(url(org, '/portal')).expect(200);
      expect(home.body.subscription).toMatchObject({ state: 'restricted', fullAccess: false });
      await org.owner.get(url(org, '/billing')).expect(200);
    });

    it('a suspended organisation is blocked for every role, apart from billing and the notice', async () => {
      const org = await makeOrg();
      await superAgent
        .post(platform(org, '/subscription/suspend'))
        .send({ reason: 'Unpaid for three months (test)' })
        .expect(200);
      expect((await state(org)).state).toBe('suspended');
      for (const agent of [org.owner, org.admin, org.member]) {
        const refused = await agent.get(url(org, '/library')).expect(403);
        expect(refused.body.error.reason).toBe('SUBSCRIPTION_INACTIVE');
      }
      await org.member.get(url(org, '/portal')).expect(200);
      await org.owner.get(url(org, '/billing')).expect(200);
      await org.member.get(url(org, '/billing')).expect(403); // members never see billing

      await superAgent
        .post(platform(org, '/subscription/reactivate'))
        .send({ reason: 'Paid in full (test)' })
        .expect(200);
      expect((await state(org)).state).toBe('active');
      await org.member.get(url(org, '/library')).expect(200);
    });

    it('an organisation without a subscription has no access', async () => {
      const organisation = await createOrganisation(context.db, undefined, { subscription: null });
      const member = (await signedInMember(context, organisation.id, 'member')).agent;
      const refused = await member
        .get(`/api/v1/organisations/${organisation.id}/library`)
        .expect(403);
      expect(refused.body.error.reason).toBe('SUBSCRIPTION_INACTIVE');
    });

    it('cancelling at the period end keeps access until then; cancelling now restricts after grace', async () => {
      const org = await makeOrg();
      await setPeriod(org, new Date(Date.now() - 10 * DAY), new Date(Date.now() + 20 * DAY));
      await superAgent
        .post(platform(org, '/subscription/cancel'))
        .send({ reason: 'The church asked to stop (test)', when: 'period_end' })
        .expect(200);
      const access = await state(org);
      expect(access.state).toBe('active');
      expect(access.message).toContain('cancelled');
      await org.member.get(url(org, '/library')).expect(200);

      const other = await makeOrg();
      await superAgent
        .post(platform(other, '/subscription/cancel'))
        .send({ reason: 'Closed immediately (test)', when: 'now' })
        .expect(200);
      expect((await state(other)).state).toBe('grace'); // grace period still applies
    });
  });

  describe('plan features', () => {
    it('features not in the plan are refused by the server, not just hidden', async () => {
      const org = await makeOrg('standard'); // no AI answers
      const ai = await org.member
        .post(url(org, '/ai/ask'))
        .send({ question: 'What is the quorum?' })
        .expect(403);
      expect(ai.body.error.reason).toBe('FEATURE_NOT_IN_PLAN');
      expect((await org.member.get(url(org, '/ai/status')).expect(200)).body).toMatchObject({
        available: false,
        includedInPlan: false,
      });
      // Finding clauses (no AI) is in every plan.
      await org.member.post(url(org, '/ai/find-clauses')).send({ question: 'quorum' }).expect(200);
      await org.member.get(url(org, '/answers')).expect(200);

      await context.db.update(plans).set({ features: [] }).where(eq(plans.code, 'standard'));
      try {
        const answers = await org.member.get(url(org, '/answers')).expect(403);
        expect(answers.body.error.reason).toBe('FEATURE_NOT_IN_PLAN');
        await org.member
          .get(url(org, '/simple-words?versionId=00000000-0000-4000-8000-000000000000'))
          .expect(403);
        await org.admin.patch(url(org, '/branding')).send({ tagline: 'New' }).expect(403);
      } finally {
        await context.db
          .update(plans)
          .set({ features: ['approved_answers', 'simple_words', 'custom_branding'] })
          .where(eq(plans.code, 'standard'));
      }
    });
  });

  describe('usage limits', () => {
    it('refuses going over the members and documents limits', async () => {
      await context.db
        .insert(plans)
        .values({
          code: 'tiny-test',
          name: 'Tiny (test)',
          features: [],
          maxMembers: 3,
          maxConstitutions: 1,
        })
        .onConflictDoNothing();
      const org = await makeOrg('tiny-test'); // owner, admin, member = 3 members
      const full = await org.owner
        .post(url(org, '/invitations'))
        .send({ email: 'one-too-many@example.test', role: 'member' })
        .expect(403);
      expect(full.body.error.reason).toBe('PLAN_LIMIT_REACHED');
      expect(full.body.error.message).toContain('up to 3 members');

      await org.admin.post(url(org, '/constitutions')).send({ title: 'First' }).expect(201);
      const second = await org.admin
        .post(url(org, '/constitutions'))
        .send({ title: 'Second' })
        .expect(403);
      expect(second.body.error.reason).toBe('PLAN_LIMIT_REACHED');
    });

    it('refuses AI questions once the monthly allowance is used', async () => {
      await context.db
        .insert(plans)
        .values({
          code: 'ai-test',
          name: 'AI (test)',
          features: ['ai_answers'],
          maxAiQuestionsPerMonth: 1,
        })
        .onConflictDoNothing();
      const org = await makeOrg('ai-test');
      await context.db.execute(sql`INSERT INTO usage_records (organisation_id, metric, quantity)
                                   VALUES (${org.id}, 'ai.questions', 1)`);
      const refused = await org.member
        .post(url(org, '/ai/ask'))
        .send({ question: 'What is the quorum?' })
        .expect(403);
      expect(refused.body.error.reason).toBe('PLAN_LIMIT_REACHED');
    });
  });

  describe('manual payments', () => {
    it('invoice → owner reports a payment → still unpaid → Super Admin verifies → paid with a receipt', async () => {
      const org = await makeOrg();
      const issued = await superAgent
        .post(platform(org, '/invoices'))
        .send({
          description: 'Premium plan, monthly (test)',
          amountMinor: 50_000,
          dueAt: new Date(Date.now() + 7 * DAY).toISOString(),
        })
        .expect(201);
      const invoice = issued.body.invoices[0];
      expect(invoice).toMatchObject({ status: 'open', amountMinor: 50_000, currency: 'BWP' });
      expect(invoice.number).toMatch(/^INV-\d{4}-\d{4,}$/);
      expect((await state(org)).paymentStatus).toBe('awaiting_payment');

      // Only owners can report a payment.
      await org.admin
        .post(url(org, `/billing/invoices/${invoice.id}/payments`))
        .send({
          amountMinor: 50_000,
          method: 'bank_transfer',
          reference: 'EFT RBPC NOV',
          paidOn: '2026-11-02',
        })
        .expect(403);
      const reported = await org.owner
        .post(url(org, `/billing/invoices/${invoice.id}/payments`))
        .send({
          amountMinor: 50_000,
          method: 'bank_transfer',
          reference: 'EFT RBPC NOV',
          paidOn: '2026-11-02',
        })
        .expect(201);
      const payment = reported.body.invoices[0].payments[0];
      expect(payment).toMatchObject({ status: 'pending_verification', receiptNumber: null });
      expect(reported.body.invoices[0].status).toBe('open'); // reporting does not mark it paid
      expect(reported.body.access.paymentStatus).toBe('awaiting_verification');
      expect(reported.body.manualPayments.notice).toContain('checked by hand');

      // A second report while one waits is refused.
      await org.owner
        .post(url(org, `/billing/invoices/${invoice.id}/payments`))
        .send({ amountMinor: 50_000, method: 'cash', reference: 'Again', paidOn: '2026-11-02' })
        .expect(409);

      // Verification needs an explicit confirmation from a Super Admin.
      await superAgent
        .post(platform(org, `/payments/${payment.id}/verify`))
        .send({})
        .expect(400);
      const verified = await superAgent
        .post(platform(org, `/payments/${payment.id}/verify`))
        .send({ confirmed: true, note: 'Seen on the statement (test)' })
        .expect(200);
      expect(verified.body.invoices[0].status).toBe('paid');
      expect(verified.body.invoices[0].payments[0].receiptNumber).toMatch(/^RCP-\d{4}-\d{4,}$/);
      await superAgent
        .post(platform(org, `/payments/${payment.id}/verify`))
        .send({ confirmed: true })
        .expect(409);

      const billing = (await org.owner.get(url(org, '/billing')).expect(200)).body;
      expect(billing.access.paymentStatus).toBe('paid');
      expect(billing.events.map((event: { kind: string }) => event.kind)).toEqual(
        expect.arrayContaining(['invoice_issued', 'payment_verified']),
      );
      const audit = await auditEventsFor(context.db, 'payment.verified');
      expect(audit.find((event) => event.organisationId === org.id)?.metadata).toMatchObject({
        method: 'manual verification (no payment provider)',
      });
    });

    it('a rejected payment leaves the invoice unpaid; an unpaid invoice eventually restricts access', async () => {
      const org = await makeOrg();
      const issued = await superAgent
        .post(platform(org, '/invoices'))
        .send({
          description: 'Overdue (test)',
          amountMinor: 1_000,
          dueAt: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(201);
      const invoiceId = issued.body.invoices[0].id as string;
      const reported = await org.owner
        .post(url(org, `/billing/invoices/${invoiceId}/payments`))
        .send({
          amountMinor: 1_000,
          method: 'mobile_money',
          reference: 'OM 777',
          paidOn: '2026-11-01',
        })
        .expect(201);
      await superAgent
        .post(platform(org, `/payments/${reported.body.invoices[0].payments[0].id}/reject`))
        .send({ reason: 'Not on the statement (test)' })
        .expect(200);
      const after = (await org.owner.get(url(org, '/billing')).expect(200)).body;
      expect(after.invoices[0].status).toBe('open');
      expect(after.invoices[0].payments[0]).toMatchObject({
        status: 'rejected',
        receiptNumber: null,
      });

      await context.db
        .update(invoices)
        .set({ dueAt: new Date(Date.now() - 30 * DAY), issuedAt: new Date(Date.now() - 40 * DAY) })
        .where(eq(invoices.id, invoiceId));
      expect((await state(org)).state).toBe('restricted');
      await org.member.get(url(org, '/library')).expect(403);
    });

    it('never accepts card numbers, and the database cannot store a self-verified payment', async () => {
      const org = await makeOrg();
      const issued = await superAgent
        .post(platform(org, '/invoices'))
        .send({
          description: 'Card test',
          amountMinor: 1_000,
          dueAt: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(201);
      const invoiceId = issued.body.invoices[0].id as string;
      const refused = await org.owner
        .post(url(org, `/billing/invoices/${invoiceId}/payments`))
        .send({
          amountMinor: 1_000,
          method: 'other',
          reference: '4111 1111 1111 1111',
          paidOn: '2026-11-01',
        })
        .expect(400);
      expect(refused.body.error.message).toContain('card');
      await org.owner
        .post(url(org, `/billing/invoices/${invoiceId}/payments`))
        .send({ amountMinor: 1_000, method: 'card', reference: 'x', paidOn: '2026-11-01' })
        .expect(400);

      // Even straight in the database, "verified" needs a verifier and a receipt number.
      await expect(
        context.db.insert(payments).values({
          organisationId: org.id,
          invoiceId,
          amountMinor: 1_000,
          currency: 'BWP',
          method: 'cash',
          reference: 'forged',
          paidOn: '2026-11-01',
          status: 'verified',
        }),
      ).rejects.toThrow();
    });

    it("an owner cannot see or pay another organisation's invoices", async () => {
      const a = await makeOrg();
      const b = await makeOrg();
      const issued = await superAgent
        .post(platform(b, '/invoices'))
        .send({
          description: 'B only',
          amountMinor: 1_000,
          dueAt: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(201);
      const bInvoice = issued.body.invoices[0].id as string;
      await a.owner
        .post(url(a, `/billing/invoices/${bInvoice}/payments`))
        .send({ amountMinor: 1_000, method: 'cash', reference: 'Sneaky', paidOn: '2026-11-01' })
        .expect(404);
      await a.owner.get(url(b, '/billing')).expect(404);
      expect(
        JSON.stringify((await a.owner.get(url(a, '/billing')).expect(200)).body),
      ).not.toContain('B only');
    });
  });

  describe('Super Admin controls', () => {
    it('only Super Admins manage plans, subscriptions, invoices and payments', async () => {
      const org = await makeOrg();
      for (const [method, path] of [
        ['get', '/api/v1/platform/plans'],
        ['post', '/api/v1/platform/plans'],
        ['get', '/api/v1/platform/billing/attention'],
        ['get', platform(org, '/billing')],
        ['post', platform(org, '/subscription/suspend')],
        ['post', platform(org, '/subscription/renew')],
        ['post', platform(org, '/invoices')],
      ] as const) {
        await org.owner[method](path).send({}).expect(403);
      }
    });

    it('renewing extends the period and issues the invoice when the plan has a price', async () => {
      await context.db
        .insert(plans)
        .values({
          code: 'priced-test',
          name: 'Priced (test)',
          monthlyPriceMinor: 25_000,
          features: [],
        })
        .onConflictDoNothing();
      const org = await makeOrg('priced-test');
      const end = new Date(Date.now() + 3 * DAY);
      await setPeriod(org, new Date(Date.now() - 27 * DAY), end);
      const renewed = await superAgent.post(platform(org, '/subscription/renew')).expect(200);
      const newEnd = new Date(renewed.body.subscription.currentPeriodEnd);
      expect(newEnd.getTime()).toBeGreaterThan(end.getTime() + 27 * DAY);
      expect(renewed.body.invoices[0]).toMatchObject({ amountMinor: 25_000, status: 'open' });

      const pilot = await makeOrg('trial', 'trialing');
      await superAgent.post(platform(pilot, '/subscription/renew')).expect(409);
    });

    it('plan changes and subscription updates are validated and recorded', async () => {
      const org = await makeOrg();
      await superAgent
        .put(platform(org, '/subscription'))
        .send({ planCode: 'does-not-exist', status: 'active' })
        .expect(400);
      await superAgent
        .put(platform(org, '/subscription'))
        .send({ planCode: 'standard', status: 'suspended' })
        .expect(400); // suspension needs its own step, with a reason
      await superAgent
        .put(platform(org, '/subscription'))
        .send({ planCode: 'trial', status: 'trialing', billingInterval: 'monthly' })
        .expect(400); // pilots are not billed
      const updated = await superAgent
        .put(platform(org, '/subscription'))
        .send({
          planCode: 'standard',
          status: 'active',
          billingInterval: 'annual',
          autoRenew: false,
        })
        .expect(200);
      expect(updated.body.subscription).toMatchObject({
        planCode: 'standard',
        billingInterval: 'annual',
        autoRenew: false,
      });

      const created = await superAgent
        .post('/api/v1/platform/plans')
        .send({
          code: 'church-test',
          name: 'Church (test)',
          monthlyPriceMinor: 15_000,
          features: ['simple_words'],
          maxMembers: 0,
        })
        .expect(400); // a members limit of 0 makes no sense
      expect(created.body.error.code).toBe('BAD_REQUEST');
      await superAgent
        .post('/api/v1/platform/plans')
        .send({
          code: 'church-test',
          name: 'Church (test)',
          monthlyPriceMinor: 15_000,
          features: ['simple_words'],
        })
        .expect(201);
      const events = await auditEventsFor(context.db, 'plan.created');
      expect(events.some((event) => event.targetId === 'church-test')).toBe(true);
    });

    it('lists what needs attention, including organisations whose retention period has passed', async () => {
      const org = await makeOrg();
      await setPeriod(org, new Date(Date.now() - 400 * DAY), new Date(Date.now() - 300 * DAY));
      const attention = (await superAgent.get('/api/v1/platform/billing/attention').expect(200))
        .body;
      const entry = attention.restricted.find(
        (item: { organisationId: string }) => item.organisationId === org.id,
      );
      expect(entry).toMatchObject({ state: 'restricted', retentionPassed: true });
      // Nothing is deleted automatically.
      const [stillThere] = await context.db
        .select()
        .from(organisations)
        .where(eq(organisations.id, org.id));
      expect(stillThere).toBeDefined();
    });
  });
});
