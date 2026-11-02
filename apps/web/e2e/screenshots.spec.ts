// Captures screenshots of the control centre for review. Runs only when CAPTURE_SCREENSHOTS=1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Screenshots are captured only on request.');

const OUT = path.join(__dirname, '..', 'screenshots');
const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;

async function signIn(page: Page, email = 'superadmin@sample.test') {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function openChoir(page: Page) {
  await page.getByRole('link', { name: 'Organisations' }).first().click();
  await page.getByRole('link', { name: 'Sample Community Choir (fictional)' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sample Community Choir');
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('capture', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await shot(page, 'desktop-01-sign-in');

    await signIn(page);
    await expect(page.getByText('Operational').first()).toBeVisible();
    await shot(page, 'desktop-02-overview');

    await page.getByRole('link', { name: 'Organisations' }).first().click();
    await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
    await expect(page.getByText('Sample Netball Club (fictional)')).toBeVisible();
    await shot(page, 'desktop-03-organisations');

    await page.getByRole('button', { name: 'New organisation' }).click();
    await page.getByLabel('Organisation name').fill('Riverside Bowls Club (fictional)');
    await shot(page, 'desktop-04-new-organisation-form');

    await openChoir(page);
    await shot(page, 'desktop-05-organisation-detail');

    const access = page.getByRole('form', { name: 'Request support access' });
    await access.getByLabel(/Reason for viewing/).fill('Checking clause numbering for ticket 1042');
    await access.getByRole('button', { name: 'View published constitution' }).click();
    await expect(page.getByText(/quorum for a general meeting/).first()).toBeVisible();
    await page.getByRole('heading', { name: 'Support access to content' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'desktop-06-support-access.png') });

    await page.getByRole('link', { name: 'Support', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible();
    await shot(page, 'desktop-07-support');

    await page.getByRole('link', { name: 'Audit log' }).first().click();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await shot(page, 'desktop-08-audit-log');

    await page.getByRole('link', { name: 'System health' }).first().click();
    await expect(page.getByText('Operational').first()).toBeVisible();
    await shot(page, 'desktop-09-system-health');
  });

  test('restricted view for an organisation administrator', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await page.getByLabel('Email address').fill('admin@sample.test');
    await page.getByLabel('Password').fill(accounts['admin@sample.test'] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'This area is restricted' })).toBeVisible();
    await shot(page, 'desktop-10-restricted');
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('capture', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText('Operational').first()).toBeVisible();
    await shot(page, 'phone-01-overview');
    await openChoir(page);
    await shot(page, 'phone-02-organisation-detail');
  });
});
