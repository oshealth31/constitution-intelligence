// Helper (not for merging): a guided tour of the whole system with sample data, saving a
// screenshot at each step to apps/web/screenshots/tour-*.png. Runs only with CAPTURE_SCREENSHOTS=1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { codeForStep, currentStep, freshCode } from './totp';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Screenshots are only captured on request.');
test.setTimeout(300_000);
test.describe.configure({ retries: 0 });

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const SLUG = 'sample-community-choir';
const CHOIR = `/o/${SLUG}`;
const OUT = path.join(__dirname, '..', 'screenshots');
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `tour-${name}.png`), fullPage });
}

async function newPage(browser: Browser, viewport = DESKTOP, mobile = false) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  return { context, page: await context.newPage() };
}

async function portalSignIn(page: Page, email: string) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function adminSignIn(page: Page, capture = false) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill('superadmin@sample.test');
  await page.getByLabel('Password').fill(accounts['superadmin@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  if (capture) await shot(page, '24-admin-two-step-code');
  await page.getByLabel('Authenticator code').fill(await freshCode('superadmin@sample.test'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`/api/v1${url}`, {
    method,
    data,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  expect(response.ok(), `${method} ${url} → ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json().catch(() => undefined)) as T;
}

async function organisationId(page: Page): Promise<string> {
  const me = await api<{ memberships: { organisationSlug: string; organisationId: string }[] }>(
    page,
    'GET',
    '/auth/me',
  );
  return me.memberships.find((item) => item.organisationSlug === SLUG)!.organisationId;
}

test('system tour', async ({ browser }) => {
  // ---------- Set up sample content an administrator would create ----------
  const admin = await newPage(browser);
  await portalSignIn(admin.page, 'admin@sample.test');
  const orgId = await organisationId(admin.page);
  const overview = await api<{
    constitutions: { clauses: { clause: { sectionId: string; reference: string | null } }[] }[];
  }>(admin.page, 'GET', `/organisations/${orgId}/manage/simple-words`);
  const clauseId = (reference: string) =>
    overview.constitutions[0]!.clauses.find((item) => item.clause.reference === reference)!.clause
      .sectionId;
  for (const [reference, text] of [
    [
      '8',
      'Every member gets one vote. Most decisions need more than half of the members who are there to agree.',
    ],
    [
      '6',
      'There must be an annual general meeting every year. Members must be told about it in writing at least 21 days before.',
    ],
  ] as const) {
    await api(
      admin.page,
      'PUT',
      `/organisations/${orgId}/manage/simple-words/sections/${clauseId(reference)}`,
      { text },
    );
    await api(
      admin.page,
      'POST',
      `/organisations/${orgId}/manage/simple-words/sections/${clauseId(reference)}/approve`,
      { confirmed: true },
    );
  }
  const answer = await api<{ id: string }>(
    admin.page,
    'POST',
    `/organisations/${orgId}/manage/answers`,
    {
      question: 'How much notice is needed for the annual general meeting?',
      answer: 'Members must get at least 21 days’ written notice of the annual general meeting.',
      clauses: ['6'],
    },
  );
  await api(admin.page, 'POST', `/organisations/${orgId}/manage/answers/${answer.id}/approve`, {
    confirmed: true,
  });
  await api(admin.page, 'POST', `/organisations/${orgId}/manage/answers/import`, {
    answers: [
      {
        question: 'Who keeps the choir accounts?',
        answer:
          'The Treasurer keeps the accounts and presents them at every annual general meeting.',
        clauses: ['9'],
        draftedBy: 'ai',
      },
    ],
  });

  const superAdmin = await newPage(browser);
  await adminSignIn(superAdmin.page, true);
  await api(superAdmin.page, 'POST', `/platform/organisations/${orgId}/invoices`, {
    description: 'Pilot set-up and training (sample)',
    amountMinor: 150_000,
    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  });

  const owner = await newPage(browser);
  await portalSignIn(owner.page, 'owner@sample.test');
  const billing = await api<{ invoices: { id: string; number: string }[] }>(
    owner.page,
    'GET',
    `/organisations/${orgId}/billing`,
  );
  await api(
    owner.page,
    'POST',
    `/organisations/${orgId}/billing/invoices/${billing.invoices[0]!.id}/payments`,
    {
      amountMinor: 150_000,
      method: 'bank_transfer',
      reference: 'FNB EFT CHOIR NOV',
      paidOn: new Date().toISOString().slice(0, 10),
    },
  );

  // ---------- 1. A member's experience ----------
  const member = await newPage(browser);
  const page = member.page;
  await page.goto(`${CHOIR}/sign-in`);
  await expect(page.getByLabel('Email address')).toBeVisible();
  await shot(page, '01-sign-in');
  await page.getByLabel('Email address').fill('member@sample.test');
  await page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
  await shot(page, '02-home', true);

  await page.goto(`${CHOIR}/search`);
  await page.getByLabel('What are you looking for?').fill('quorum');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('link', { name: /Quorum/ }).first()).toBeVisible();
  await shot(page, '03-search');

  await page.getByLabel('What are you looking for?').fill('voting');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .getByRole('link', { name: /8\. Voting/ })
    .first()
    .click();
  await expect(page.getByRole('note', { name: 'Reference for this section' })).toBeVisible();
  await shot(page, '04-reader');
  await page.getByRole('button', { name: 'Simple words', exact: true }).click();
  await expect(page.getByLabel('Simple words for Clause 8', { exact: true })).toBeVisible();
  await page.getByLabel('Simple words for Clause 8', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '05-reader-simple-words');

  await page.goto(`${CHOIR}/ask`);
  await expect(page.getByRole('heading', { name: 'Common questions' })).toBeVisible();
  await page
    .getByLabel('Your question')
    .fill('How much notice is needed for the annual general meeting?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Was this helpful?').first()).toBeVisible();
  await shot(page, '06-ask-approved-and-ai', true);

  const clauses = await newPage(browser);
  await clauses.page.route('**/organisations/*/ai/status', (route) =>
    route.fulfill({
      json: {
        available: false,
        mode: 'disabled',
        includedInPlan: false,
        disclaimer: 'Not legal advice.',
        unsupportedMessage: '',
        clauseFinder: true,
      },
    }),
  );
  await clauses.page.goto(`${CHOIR}/sign-in`);
  await clauses.page.getByLabel('Email address').fill('member@sample.test');
  await clauses.page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await clauses.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(clauses.page.locator('#welcome-heading')).toBeVisible();
  await clauses.page.goto(`${CHOIR}/ask`);
  await clauses.page
    .getByLabel('Your question')
    .fill('How many members must be present for a quorum?');
  await clauses.page.getByRole('button', { name: 'Find clauses' }).click();
  await expect(
    clauses.page.getByRole('heading', { name: /matching clauses? from the approved/ }),
  ).toBeVisible();
  await shot(clauses.page, '07-find-clauses-no-ai');

  // Offline
  await page.goto(CHOIR);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('button', { name: 'Save for offline reading' }).click();
  await expect(
    page.getByText('Saved. You can now read the constitution without the internet.'),
  ).toBeVisible();
  await page.getByText('Read without internet').scrollIntoViewIfNeeded();
  await shot(page, '08-saved-for-offline');
  await member.context.setOffline(true);
  await page.goto(`${CHOIR}/library`);
  await expect(page.getByTestId('connection-status')).toHaveText('Offline');
  await shot(page, '09-offline-reader');
  await page.getByRole('textbox', { name: 'Search the saved copy' }).fill('meeting notice');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible();
  await shot(page, '10-offline-search');
  await member.context.setOffline(false);

  // Phone
  const phone = await newPage(browser, PHONE, true);
  await phone.page.goto(`${CHOIR}/sign-in`);
  await phone.page.getByLabel('Email address').fill('member@sample.test');
  await phone.page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await phone.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(phone.page.locator('#welcome-heading')).toBeVisible();
  await shot(phone.page, '11-phone-home');
  await phone.page.goto(`${CHOIR}/ask`);
  await expect(phone.page.getByRole('heading', { name: 'Common questions' })).toBeVisible();
  await shot(phone.page, '12-phone-common-questions');

  // ---------- 2. Organisation administrators ----------
  const a = admin.page;
  await a.goto(`${CHOIR}/manage/content`);
  await expect(a.getByText(/Every version goes through these steps/)).toBeVisible();
  await shot(a, '13-manage-documents', true);
  await a
    .getByRole('link', { name: /Review details|Check and correct/ })
    .first()
    .click();
  await expect(a.getByText(/Version/).first()).toBeVisible();
  await shot(a, '14-version-review');

  await a.goto(`${CHOIR}/manage/answers`);
  await expect(
    a.getByRole('link', { name: 'How much notice is needed for the annual general meeting?' }),
  ).toBeVisible();
  await shot(a, '15-approved-answers-list', true);
  await a.getByRole('link', { name: 'Who keeps the choir accounts?' }).first().click();
  await expect(a.getByText('This draft was written by AI.')).toBeVisible();
  await shot(a, '16-answer-review', true);

  await a.goto(`${CHOIR}/manage/simple-words`);
  await expect(
    a.getByRole('listitem', { name: 'Simple words for Clause 8', exact: true }),
  ).toBeVisible();
  await shot(a, '17-simple-words-manage');

  await owner.page.goto(`${CHOIR}/manage/subscription`);
  await expect(owner.page.getByText('Manual payment verification.')).toBeVisible();
  await shot(owner.page, '18-subscription-owner', true);

  // ---------- 3. Constitution Intelligence staff (Super Admin) ----------
  const s = superAdmin.page;
  await s.goto('/admin');
  await expect(s.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await shot(s, '19-control-centre-overview', true);
  await s.goto('/admin/organisations');
  await s
    .getByRole('link', { name: 'Sample Community Choir (fictional)', exact: true })
    .first()
    .click();
  await expect(s.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await shot(s, '20-organisation-detail', true);
  await s.goto('/admin/billing');
  await expect(s.getByText(/Payments to verify/)).toBeVisible();
  await shot(s, '21-billing-attention');
  await s.goto('/admin/plans');
  await expect(s.getByText('Pilot').first()).toBeVisible();
  await shot(s, '22-plans', true);
  await s.goto('/admin/audit');
  await expect(s.getByRole('heading', { name: /Audit/ })).toBeVisible();
  await shot(s, '23-audit-log');

  // ---------- 4. Security and account care (Tasks D2, D3, D5) ----------
  // Owner: two-step sign-in on the profile page, and a leaked password refused.
  const o = owner.page;
  await o.goto(`${CHOIR}/profile`);
  await o.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  await expect(o.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await o.getByRole('img', { name: 'QR code for your authenticator app' }).scrollIntoViewIfNeeded();
  await shot(o, '25-owner-two-step-setup');
  await o.getByRole('button', { name: 'Cancel' }).click();
  const change = o.getByRole('form', { name: 'Change password' });
  await change.getByLabel('Current password').fill(accounts['owner@sample.test'] ?? '');
  await change.getByLabel('New password').fill('1qaz2wsx3edc');
  await change.getByRole('button', { name: 'Change password' }).click();
  await expect(o.getByText(/known data leak/)).toBeVisible();
  await change.scrollIntoViewIfNeeded();
  await shot(o, '26-leaked-password-refused');

  // A new member of staff: the Control Centre stays locked until two-step sign-in is set up.
  const staff = await newPage(browser);
  const t = staff.page;
  await t.goto('/admin/sign-in');
  await t.getByLabel('Email address').fill('newstaff@sample.test');
  await t.getByLabel('Password').fill(accounts['newstaff@sample.test'] ?? '');
  await t.getByRole('button', { name: 'Sign in' }).click();
  await expect(t.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  await shot(t, '27-staff-two-step-required', true);
  const key = ((await t.getByTestId('two-step-setup-key').textContent()) ?? '').replace(/\s/g, '');
  await t.getByLabel('6-digit code from the app').fill(codeForStep(key, currentStep()));
  await t.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await expect(t.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await shot(t, '28-staff-recovery-codes');
  await t.getByRole('button', { name: 'I have saved my recovery codes' }).click();
  await expect(t.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  await s.goto('/admin/support');
  await expect(s.getByRole('form', { name: 'Reset two-step sign-in' })).toBeVisible();
  await shot(s, '29-support-two-step', true);

  // Deleting an organisation that has left: requested by one Super Admin, approved by another.
  const bowls = await api<{ organisation: { id: string; slug: string } }>(
    s,
    'POST',
    '/platform/organisations',
    { name: 'Sample Bowls Club (fictional)', slug: 'sample-bowls-club' },
  );
  const bowlsId = bowls.organisation?.id ?? (bowls as unknown as { id: string }).id;
  await api(s, 'POST', `/platform/organisations/${bowlsId}/status`, {
    status: 'suspended',
    reason: 'Pilot ended; the club asked to leave (sample)',
  });
  await s.goto(`/admin/organisations/${bowlsId}`);
  const request = s.getByRole('form', { name: 'Request deletion' });
  await request.getByLabel(/^Reason/).fill('Pilot ended; owner asked in writing on 3 Nov (sample)');
  await request.getByRole('checkbox').check();
  await request.getByLabel(/Type the web address/).fill('sample-bowls-club');
  await request.scrollIntoViewIfNeeded();
  await shot(s, '30-deletion-request');
  await request.getByRole('button', { name: 'Request deletion' }).click();
  await expect(s.getByText('Waiting for another Super Admin to approve it.')).toBeVisible();
  await s.getByText('Waiting for another Super Admin to approve it.').scrollIntoViewIfNeeded();
  await shot(s, '31-deletion-waiting');
  await t.goto(`/admin/organisations/${bowlsId}`);
  const approve = t.getByRole('form', { name: 'Approve deletion' });
  await approve.getByLabel(/Type the web address/).fill('sample-bowls-club');
  await approve.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(t.getByRole('heading', { name: 'Data deleted' })).toBeVisible();
  await shot(t, '32-deletion-done', true);

  for (const context of [admin, superAdmin, owner, member, clauses, phone, staff])
    await context.context.close();
});
