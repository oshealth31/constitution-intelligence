import { describe, expect, it } from 'vitest';
import { computeAccess, type InvoiceFacts, type PlanFacts, type SubscriptionFacts } from './access';

const DAY = 86_400_000;
const now = new Date('2026-06-15T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);

const plan: PlanFacts = {
  code: 'standard',
  name: 'Standard',
  isPilot: false,
  graceDays: 14,
  features: ['approved_answers', 'simple_words', 'not_a_feature'],
  limits: { members: 50, constitutions: 2, aiQuestionsPerMonth: 0, storageMb: 100 },
};

function subscription(overrides: Partial<SubscriptionFacts> = {}): SubscriptionFacts {
  return {
    id: 's',
    status: 'active',
    currentPeriodStart: at(-20),
    currentPeriodEnd: at(10),
    billingInterval: 'monthly',
    autoRenew: true,
    suspendedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

const access = (
  sub: SubscriptionFacts | null,
  invoices: InvoiceFacts[] = [],
  p: PlanFacts | null = plan,
) => computeAccess({ subscription: sub, plan: p, invoices, now, retentionDays: 90 });

describe('computeAccess', () => {
  it('an active subscription in its period has full access to its plan only', () => {
    const result = access(subscription());
    expect(result).toMatchObject({
      state: 'active',
      fullAccess: true,
      readOnly: false,
      renewal: 'renews',
    });
    expect(result.features).toEqual(['approved_answers', 'simple_words']);
    expect(result.limits.members).toBe(50);
    expect(result.paymentStatus).toBe('not_required');
  });

  it('a pilot is a pilot, not billed', () => {
    const result = access(
      subscription({ status: 'trialing', billingInterval: 'none', currentPeriodEnd: at(5) }),
    );
    expect(result).toMatchObject({ state: 'pilot', fullAccess: true, renewal: 'not_applicable' });
    expect(result.message).toContain('Pilot subscription until');
  });

  it('after the period ends there is a grace period with full access', () => {
    const result = access(subscription({ currentPeriodEnd: at(-3) }));
    expect(result).toMatchObject({ state: 'grace', fullAccess: true });
    expect(result.graceEndsAt).toBe(at(11).toISOString());
  });

  it('after the grace period access is restricted, read-only, and data is kept for the retention period', () => {
    const result = access(subscription({ currentPeriodEnd: at(-15) }));
    expect(result).toMatchObject({ state: 'restricted', fullAccess: false, readOnly: true });
    expect(result.restrictedSince).toBe(at(-1).toISOString());
    expect(result.dataRetainedUntil).toBe(at(89).toISOString());
  });

  it('an overdue invoice starts the grace period even inside the paid period', () => {
    const due = { status: 'open' as const, dueAt: at(-20), hasPendingPayment: false };
    expect(access(subscription(), [due]).state).toBe('restricted');
    expect(access(subscription(), [{ ...due, dueAt: at(-2) }]).state).toBe('grace');
    expect(access(subscription(), [{ ...due, dueAt: at(-2) }]).paymentStatus).toBe('overdue');
  });

  it('a reported payment does not count until it is verified', () => {
    const reported = { status: 'open' as const, dueAt: at(-20), hasPendingPayment: true };
    const result = access(subscription(), [reported]);
    expect(result.state).toBe('restricted');
    expect(result.paymentStatus).toBe('awaiting_verification');
    expect(access(subscription(), [{ ...reported, status: 'paid' }]).state).toBe('active');
    expect(access(subscription(), [{ ...reported, status: 'paid' }]).paymentStatus).toBe('paid');
  });

  it('an open invoice not yet due is awaiting payment, with full access', () => {
    const result = access(subscription(), [
      { status: 'open', dueAt: at(5), hasPendingPayment: false },
    ]);
    expect(result).toMatchObject({ state: 'active', paymentStatus: 'awaiting_payment' });
  });

  it('suspension blocks everything, whatever the dates', () => {
    const result = access(subscription({ status: 'suspended', suspendedAt: at(-1) }));
    expect(result).toMatchObject({ state: 'suspended', fullAccess: false, readOnly: false });
  });

  it('no subscription or no plan means no access', () => {
    expect(access(null).state).toBe('none');
    expect(access(subscription(), [], null).state).toBe('none');
  });

  it('a subscription cancelled at the period end keeps access until then, then lapses', () => {
    const cancelled = subscription({ status: 'cancelled', cancelledAt: at(-1), autoRenew: false });
    expect(access(cancelled)).toMatchObject({ state: 'active', fullAccess: true, renewal: 'ends' });
    expect(access(cancelled).message).toContain('cancelled');
    expect(access({ ...cancelled, currentPeriodEnd: at(-30) }).state).toBe('restricted');
  });

  it('a subscription cancelled with no end date lapses from the cancellation', () => {
    const result = access(
      subscription({ status: 'cancelled', cancelledAt: at(-20), currentPeriodEnd: null }),
    );
    expect(result.state).toBe('restricted');
  });
});
