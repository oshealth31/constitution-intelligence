'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, TextField } from '@/components/ui';
import { apiFetch, describeError } from '@/lib/api';
import {
  amountText,
  FEATURE_LABELS,
  formatMoney,
  parseAmount,
  PLAN_FEATURES,
  type Plan,
  type PlanFeature,
} from '@/lib/billing';
import { useApi } from '@/lib/use-api';

const limitText = (value: number | null) => (value === null ? 'no limit' : String(value));

/** The product's plans: prices, grace period, features and limits. */
export default function PlansPage() {
  const plans = useApi<Plan[]>('/platform/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);

  if (plans.error) return <Alert>{describeError(plans.error)}</Alert>;
  if (!plans.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Plans"
        description="What each plan includes and costs. Changes apply to every organisation on the plan straight away (the server checks the plan on every request). Prices are in the smallest unit internally; enter them in pula."
        actions={<Button onClick={() => setEditing('new')}>New plan</Button>}
      />
      {editing && (
        <div className="mb-6">
          <PlanForm
            plan={editing === 'new' ? null : editing}
            onDone={async () => {
              setEditing(null);
              await plans.reload();
            }}
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.data.map((plan) => (
          <Card
            key={plan.code}
            title={
              <span className="flex items-center gap-2">
                {plan.name} <span className="text-xs text-muted">({plan.code})</span>
                {plan.isPilot && <Badge tone="info">Pilot</Badge>}
                {!plan.active && <Badge tone="neutral">Not offered</Badge>}
              </span>
            }
            description={plan.description ?? undefined}
            actions={
              <Button variant="secondary" onClick={() => setEditing(plan)}>
                Edit
              </Button>
            }
          >
            <ul className="space-y-1 text-sm" aria-label={`Plan ${plan.code}`}>
              <li>
                Monthly: {plan.monthlyPriceMinor === null ? 'not set' : formatMoney(plan.monthlyPriceMinor, plan.currency)} · Annual:{' '}
                {plan.annualPriceMinor === null ? 'not set' : formatMoney(plan.annualPriceMinor, plan.currency)}
              </li>
              <li>Grace period: {plan.graceDays} days</li>
              <li>
                Features: {plan.features.length === 0 ? 'reading and search only' : plan.features.map((feature) => FEATURE_LABELS[feature]).join(', ')}
              </li>
              <li>
                Limits: members {limitText(plan.maxMembers)}, documents {limitText(plan.maxConstitutions)}, AI questions a month{' '}
                {limitText(plan.maxAiQuestionsPerMonth)}, storage {plan.maxStorageMb === null ? 'no limit' : `${plan.maxStorageMb} MB`}
              </li>
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

function PlanForm({ plan, onDone }: { plan: Plan | null; onDone: () => Promise<void> }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [isPilot, setIsPilot] = useState(plan?.isPilot ?? false);
  const [active, setActive] = useState(plan?.active ?? true);
  const [monthly, setMonthly] = useState(amountText(plan?.monthlyPriceMinor ?? null));
  const [annual, setAnnual] = useState(amountText(plan?.annualPriceMinor ?? null));
  const [graceDays, setGraceDays] = useState(String(plan?.graceDays ?? 14));
  const [features, setFeatures] = useState<PlanFeature[]>(plan?.features ?? []);
  const [limits, setLimits] = useState({
    maxMembers: plan?.maxMembers?.toString() ?? '',
    maxConstitutions: plan?.maxConstitutions?.toString() ?? '',
    maxAiQuestionsPerMonth: plan?.maxAiQuestionsPerMonth?.toString() ?? '',
    maxStorageMb: plan?.maxStorageMb?.toString() ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = (text: string) => (text.trim() === '' ? null : parseAmount(text));
    const monthlyPriceMinor = price(monthly);
    const annualPriceMinor = price(annual);
    if ((monthly.trim() && monthlyPriceMinor === null) || (annual.trim() && annualPriceMinor === null)) {
      setError('Enter prices like 250.00, or leave them empty.');
      return;
    }
    const limit = (text: string) => (text.trim() === '' ? null : Number(text));
    const body = {
      name,
      description,
      isPilot,
      active,
      monthlyPriceMinor,
      annualPriceMinor,
      graceDays: Number(graceDays),
      features,
      maxMembers: limit(limits.maxMembers),
      maxConstitutions: limit(limits.maxConstitutions),
      maxAiQuestionsPerMonth: limit(limits.maxAiQuestionsPerMonth),
      maxStorageMb: limit(limits.maxStorageMb),
    };
    setBusy(true);
    setError(null);
    try {
      await apiFetch(plan ? `/platform/plans/${plan.code}` : '/platform/plans', {
        method: plan ? 'PATCH' : 'POST',
        body: plan ? body : { ...body, code },
      });
      await onDone();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={plan ? `Edit ${plan.name}` : 'New plan'}>
      <form onSubmit={submit} aria-label="Plan" className="grid gap-4 sm:grid-cols-2">
        {!plan && <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} hint="Lower-case, e.g. church-basic" required />}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="sm:col-span-2">
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <TextField label="Monthly price (BWP)" value={monthly} onChange={(e) => setMonthly(e.target.value)} hint="Empty = not offered monthly" />
        <TextField label="Annual price (BWP)" value={annual} onChange={(e) => setAnnual(e.target.value)} hint="Empty = not offered annually" />
        <TextField label="Grace period (days)" type="number" min={0} max={90} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
        <fieldset className="text-sm sm:col-span-2">
          <legend className="font-medium text-navy-900">Features</legend>
          {PLAN_FEATURES.map((feature) => (
            <label key={feature} className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={features.includes(feature)}
                onChange={(e) =>
                  setFeatures(e.target.checked ? [...features, feature] : features.filter((item) => item !== feature))
                }
              />
              {FEATURE_LABELS[feature]}
            </label>
          ))}
        </fieldset>
        <TextField label="Members limit" type="number" min={1} value={limits.maxMembers} onChange={(e) => setLimits({ ...limits, maxMembers: e.target.value })} hint="Empty = no limit" />
        <TextField label="Documents limit" type="number" min={1} value={limits.maxConstitutions} onChange={(e) => setLimits({ ...limits, maxConstitutions: e.target.value })} hint="Empty = no limit" />
        <TextField label="AI questions a month" type="number" min={0} value={limits.maxAiQuestionsPerMonth} onChange={(e) => setLimits({ ...limits, maxAiQuestionsPerMonth: e.target.value })} hint="Empty = no limit" />
        <TextField label="Storage limit (MB)" type="number" min={1} value={limits.maxStorageMb} onChange={(e) => setLimits({ ...limits, maxStorageMb: e.target.value })} hint="Empty = no limit" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPilot} onChange={(e) => setIsPilot(e.target.checked)} /> Pilot plan (not billed)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Offered to new subscriptions
        </label>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" busy={busy}>
            Save plan
          </Button>
          <Button type="button" variant="secondary" onClick={() => void onDone()}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
