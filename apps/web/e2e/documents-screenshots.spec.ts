// Captures screenshots of document management for review. Runs only when CAPTURE_SCREENSHOTS=1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeSamplePdf } from '../../api/src/dev/sample-documents';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Screenshots are captured only on request.');

const OUT = path.join(__dirname, '..', 'screenshots');
const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';

async function signIn(page: Page, email: string) {
  await page.request.post('/api/v1/auth/logout', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

const pdf = makeSamplePdf([
  [
    { text: 'STANDING ORDERS', size: 16 },
    { text: 'PART 1 - MEETINGS' },
    { text: '1. Committee meetings' },
    { text: 'The committee meets every month. Members may attend as observers.' },
    { text: '2. Notice' },
    { text: 'Notice of a meeting is sent at least seven days before:' },
    { text: '(a) by email; or' },
    { text: '(b) on the notice board.' },
    { text: '4. Minutes' },
    { text: 'The Secretary keeps the minutes of every meeting.' },
  ],
  [],
]);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('capture', async ({ page }) => {
    await signIn(page, 'reviewer@sample.test');
    await page.goto(`${CHOIR}/manage/content`);
    await page.getByLabel('Document title').fill('Standing orders');
    await page.getByRole('button', { name: 'Add document' }).click();
    const form = page.getByRole('form', { name: 'Upload a new version of Standing orders' });
    await expect(form).toBeVisible();
    await form.getByLabel('Document file').setInputFiles({ name: 'agm-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await form.getByRole('button', { name: 'Upload' }).click();
    await expect(form.getByText(/Please choose a PDF/)).toBeVisible();
    await shot(page, 'desktop-01-documents-list');

    await form.getByLabel('Document file').setInputFiles({ name: 'standing-orders.pdf', mimeType: 'application/pdf', buffer: pdf });
    await form.getByLabel('Name for this version (optional)').fill('Adopted 2026');
    await form.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('heading', { name: /Version 1: Adopted 2026/ })).toBeVisible();
    const reviewUrl = page.url();
    await shot(page, 'desktop-02-review-flagged');

    const notice = page.getByRole('listitem', { name: 'Section 2. Notice' });
    await notice.getByRole('button', { name: 'Edit' }).click();
    await shot(page, 'desktop-03-editing-section');
    await notice.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Mark as checked' }).click();
    await expect(page.getByText('Marked as checked.')).toBeVisible();
    await page.getByLabel('I have compared this text with the original document.').check();
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.getByText('Sent for approval.')).toBeVisible();

    await signIn(page, 'admin@sample.test');
    await page.goto(reviewUrl);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await shot(page, 'desktop-04-admin-approval');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved. You can now/)).toBeVisible();
    await page.getByLabel('Yes, make this the current constitution.').check();
    await shot(page, 'desktop-05-make-current', false);
    await page.getByRole('button', { name: 'Make current' }).click();
    await expect(page.getByText(/Made the current version/)).toBeVisible();
    await shot(page, 'desktop-06-published-history');
    await page.goto(`${CHOIR}/manage/content`);
    await shot(page, 'desktop-07-documents-after');

    await signIn(page, 'member@sample.test');
    await page.goto(`${CHOIR}/library`);
    await page.getByRole('link', { name: 'Read Standing orders' }).click();
    await expect(page.getByText('Current approved version')).toBeVisible();
    await shot(page, 'desktop-08-member-reading', false);
  });
});

test.describe('phone (Android size)', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('capture', async ({ page }) => {
    await signIn(page, 'reviewer@sample.test');
    await page.goto(`${CHOIR}/manage/content`);
    await page.getByLabel('Document title').fill('Code of conduct');
    await page.getByRole('button', { name: 'Add document' }).click();
    const form = page.getByRole('form', { name: 'Upload a new version of Code of conduct' });
    await form.getByLabel('Document file').setInputFiles({ name: 'code.pdf', mimeType: 'application/pdf', buffer: pdf });
    await form.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('heading', { name: /Version 1/ })).toBeVisible();
    await shot(page, 'phone-01-review-top', false);
    await page.getByText(/Check this:/).first().scrollIntoViewIfNeeded();
    await shot(page, 'phone-02-flagged-section', false);
  });
});
