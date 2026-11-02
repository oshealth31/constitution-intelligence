/** Facts used to work out how far an organisation has got with onboarding. */
export interface OnboardingFacts {
  activeOwners: number;
  brandingConfigured: boolean;
  constitutions: number;
  files: number;
  publishedVersions: number;
  otherMembers: number;
  pendingInvitations: number;
  subscriptionStatus: string | null;
}

export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completed: number;
  total: number;
}

/** The onboarding checklist shown in the control centre. */
export function onboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const steps: OnboardingStep[] = [
    { key: 'organisation_created', label: 'Organisation created', done: true },
    { key: 'owner_joined', label: 'Owner has joined', done: facts.activeOwners > 0 },
    { key: 'branding_configured', label: 'Branding configured', done: facts.brandingConfigured },
    {
      key: 'constitution_uploaded',
      label: 'Constitution uploaded',
      done: facts.constitutions > 0 || facts.files > 0,
    },
    {
      key: 'constitution_published',
      label: 'Constitution published',
      done: facts.publishedVersions > 0,
    },
    {
      key: 'members_invited',
      label: 'Members invited',
      done: facts.otherMembers > 0 || facts.pendingInvitations > 0,
    },
    {
      key: 'subscription_active',
      label: 'Paid subscription active',
      done: facts.subscriptionStatus === 'active',
    },
  ];
  return { steps, completed: steps.filter((step) => step.done).length, total: steps.length };
}

/** "naledi@example.org" -> "n•••@example.org": enough for support, without exposing the full address. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value || !value.includes('@')) {
    return value ? '•••' : null;
  }
  const [name, domain] = value.split('@');
  return `${(name ?? '').slice(0, 1)}•••@${domain}`;
}
