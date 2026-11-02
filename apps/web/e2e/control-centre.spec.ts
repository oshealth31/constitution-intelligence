// Main control-centre workflows, driven through a real browser against the real API and database.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;

const SUPER_ADMIN = 'superadmin@sample.test';
const ORG_ADMIN = 'admin@sample.test';

async function signIn(page: Page, email: string) {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.configure({ mode: 'serial' });

test('rejects a wrong password with a clear message', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill(SUPER_ADMIN);
  await page.getByLabel('Password').fill('definitely not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password.');
});

test('sends signed-out visitors to the sign-in page', async ({ page }) => {
  await page.goto('/admin/organisations');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});

test('super admin sees live overview figures and system health', async ({ page }) => {
  await signIn(page, SUPER_ADMIN);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Sample Community Choir (fictional)')).toBeVisible();
  await expect(page.getByText('Organisations', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'System health' }).first().click();
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  await expect(page.getByText('Operational').first()).toBeVisible();
});

test('super admin creates an organisation and manages subscription, branding and status', async ({
  page,
}) => {
  const name = `E2E Bowls Club ${Date.now()} (fictional)`;
  await signIn(page, SUPER_ADMIN);
  await page.getByRole('link', { name: 'Organisations' }).first().click();
  await page.getByRole('button', { name: 'New organisation' }).click();
  await page.getByLabel('Organisation name').fill(name);
  await page.getByRole('button', { name: 'Create organisation' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  await expect(page.getByText('1 of 7 steps').first()).toBeVisible();

  const subscription = page.getByRole('form', { name: 'Subscription' });
  await subscription.getByLabel('Plan').selectOption('standard');
  await subscription.getByLabel('Status').selectOption('active');
  await subscription.getByLabel('Paid until / trial ends').fill('2030-12-31');
  await subscription.getByRole('button', { name: 'Save subscription' }).click();
  await expect(page.getByText('Subscription updated.')).toBeVisible();

  const branding = page.getByRole('form', { name: 'Branding' });
  await branding.getByLabel('Tagline').fill('Fair play on every green');
  await branding.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Branding saved.')).toBeVisible();
  await expect(page.getByText('3 of 7 steps').first()).toBeVisible();

  const status = page.getByRole('form', { name: 'Suspend organisation' });
  await status.getByLabel(/Reason/).fill('End-to-end test of suspension');
  await status.getByRole('button', { name: 'Suspend organisation' }).click();
  await expect(page.getByText(/Organisation suspended/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Suspended');

  await page.getByRole('link', { name: 'View audit log' }).click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByText('Organisation · status changed').first()).toBeVisible();
  await expect(page.getByText('Subscription · updated').first()).toBeVisible();
});

test('support access to content requires a reason and is recorded', async ({ page }) => {
  await signIn(page, SUPER_ADMIN);
  await page.getByRole('link', { name: 'Organisations' }).first().click();
  await page.getByRole('link', { name: 'Sample Community Choir (fictional)' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sample Community Choir');
  // Constitution text is not shown until access is requested.
  await expect(page.getByText(/quorum for a general meeting/)).toHaveCount(0);

  const access = page.getByRole('form', { name: 'Request support access' });
  await access
    .getByLabel(/Reason for viewing/)
    .fill('Checking clause numbering for support ticket 77');
  await access.getByRole('button', { name: 'View published constitution' }).click();
  await expect(page.getByText(/quorum for a general meeting/).first()).toBeVisible();

  await page.getByRole('link', { name: 'Audit log' }).first().click();
  await page.getByLabel('Area').selectOption('support');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('Support · content accessed').first()).toBeVisible();
});

test('an organisation administrator cannot use the control centre', async ({ page }) => {
  await signIn(page, ORG_ADMIN);
  await expect(page.getByRole('heading', { name: 'This area is restricted' })).toBeVisible();
  await expect(page.getByText('Sample Community Choir (fictional)')).toHaveCount(0);

  // The API itself refuses, whatever the page shows.
  const response = await page.request.get('/api/v1/platform/overview');
  expect(response.status()).toBe(403);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the control centre is usable on a small screen', async ({ page }) => {
    await signIn(page, SUPER_ADMIN);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await page.getByRole('link', { name: 'Organisations' }).first().click();
    await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
