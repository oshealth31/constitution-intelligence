// Task D2 in a browser, on a phone-sized screen: a new Super Admin must set up two-step sign-in
// before the Control Centre opens, then signs in with a recovery code and with an authenticator
// code; another Super Admin resets it from the Support page. Uses the seeded fictional
// "Sample New Staff Member", who has no two-step sign-in at the start of every run.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { accounts, apiFrom, signInControlCentre } from './qa-helpers';
import { codeForStep, currentStep } from './totp';

const NEW_STAFF = 'newstaff@sample.test';

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

async function passwordStep(page: Page) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill(NEW_STAFF);
  await page.getByLabel('Password').fill(accounts[NEW_STAFF] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  const result = await apiFrom(page, 'POST', '/auth/logout');
  expect(result.status).toBe(204);
}

async function fitsThePhone(page: Page) {
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(1);
}

test('a new Super Admin sets up two-step sign-in, then signs in with it', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  // 1. Password only: the Control Centre stays locked behind the setup steps.
  await passwordStep(page);
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  await page.goto('/admin/organisations');
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  const locked = await apiFrom(page, 'GET', '/platform/organisations');
  expect(locked.status).toBe(403);

  // 2. QR code, setup key, first code.
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = ((await page.getByTestId('two-step-setup-key').textContent()) ?? '').replace(
    /\s/g,
    '',
  );
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  await fitsThePhone(page);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    axe.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
  ).toEqual([]);

  await page.getByLabel('6-digit code from the app').fill('000000' === codeForStep(key, currentStep()) ? '111111' : '000000');
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();

  const setupStep = currentStep();
  await page.getByLabel('6-digit code from the app').fill(codeForStep(key, setupStep));
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();

  // 3. Recovery codes, shown once.
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  expect(codes).toHaveLength(10);
  await fitsThePhone(page);
  await page.getByRole('button', { name: 'I have saved my recovery codes' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  const me = await apiFrom(page, 'GET', '/auth/me');
  expect((me.body as { twoStep: { enabled: boolean } }).twoStep.enabled).toBe(true);

  // 4. Sign in again with a recovery code.
  await signOut(page);
  await passwordStep(page);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await fitsThePhone(page);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  // The same recovery code does not work twice.
  await signOut(page);
  await passwordStep(page);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();

  // 5. ...and with a code from the app (a later code than the one used at setup).
  await page.getByRole('button', { name: 'Use my authenticator app instead' }).click();
  while (Math.max(currentStep(), setupStep + 1) > currentStep() + 1) {
    await page.waitForTimeout(1_000);
  }
  await page
    .getByLabel('Authenticator code')
    .fill(codeForStep(key, Math.max(currentStep(), setupStep + 1)));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  // 6. Another Super Admin resets it from the Support page (lost phone).
  const other = await (await browser.newContext()).newPage();
  await signInControlCentre(other);
  await other.goto('/admin/support');
  const form = other.getByRole('form', { name: 'Reset two-step sign-in' });
  await form.getByLabel('Their email address').fill(NEW_STAFF);
  await form.getByLabel(/^Reason/).fill('Browser test: lost phone, identity confirmed (fictional)');
  await form.getByRole('button', { name: 'Reset two-step sign-in' }).click();
  await expect(other.getByText(`Two-step sign-in was reset for ${NEW_STAFF}`)).toBeVisible();

  // The reset signed the new staff member out; signing in again leads back to setup.
  const after = await apiFrom(page, 'GET', '/auth/me');
  expect(after.status).toBe(401);
  await passwordStep(page);
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
});
