// Captures screenshots of the organisation portals for review. Runs only when CAPTURE_SCREENSHOTS=1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Screenshots are captured only on request.');

const OUT = path.join(__dirname, '..', 'screenshots');
const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';
const NETBALL = '/o/sample-netball-club';

async function signIn(page: Page, portal: string, email: string) {
  await page.goto(`${portal}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

test.describe('phone (Android size)', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('capture', async ({ page }) => {
    await page.goto(`${CHOIR}/sign-in`);
    await shot(page, 'phone-01-choir-sign-in', false);
    await signIn(page, CHOIR, 'member@sample.test');
    await shot(page, 'phone-02-choir-home', false);
    await page.getByRole('link', { name: 'Read the constitution' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'phone-03-choir-reading', false);
    await page.getByRole('button', { name: 'Contents' }).click();
    await shot(page, 'phone-04-choir-contents', false);
    await page.goto(`${CHOIR}/search?q=meeting`);
    await expect(page.getByText(/result/)).toBeVisible();
    await shot(page, 'phone-05-choir-search', false);
    await page.request.post('/api/v1/auth/logout', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    await signIn(page, NETBALL, 'netball.member@sample.test');
    await shot(page, 'phone-06-netball-home', false);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true });

  test('capture', async ({ page }) => {
    await signIn(page, NETBALL, 'netball.member@sample.test');
    await page.getByRole('link', { name: 'Read the constitution' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'tablet-01-netball-reading', false);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('capture', async ({ page }) => {
    await page.goto(`${NETBALL}/sign-in`);
    await shot(page, 'desktop-01-netball-sign-in', false);
    await signIn(page, CHOIR, 'admin@sample.test');
    await shot(page, 'desktop-02-choir-home-admin', false);
    await page.getByRole('link', { name: 'Read the constitution' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'desktop-03-choir-reading', false);
    await page.goto(`${CHOIR}/search?q=quorum`);
    await expect(page.getByText(/result/)).toBeVisible();
    await shot(page, 'desktop-04-choir-search');
    await page.goto(`${CHOIR}/manage/branding`);
    await expect(page.getByRole('button', { name: 'Save branding' })).toBeVisible();
    await shot(page, 'desktop-05-manage-branding');
    await page.goto(`${CHOIR}/manage/content`);
    await expect(page.getByText(/Version 2/)).toBeVisible();
    await shot(page, 'desktop-06-content-status');
    await page.goto(`${CHOIR}/manage/members`);
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await shot(page, 'desktop-07-members');
    await page.goto(NETBALL);
    await expect(page.getByRole('heading', { name: /You are not a member/ })).toBeVisible();
    await shot(page, 'desktop-08-not-a-member', false);
  });
});
