// Constitution document management in a real browser: upload, checking flagged text,
// correction, approval by an administrator, publishing, and what members see.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeSamplePdf } from '../../api/src/dev/sample-documents';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

async function signIn(page: Page, email: string) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function signOut(page: Page) {
  await page.request.post('/api/v1/auth/logout', { headers: CSRF });
}

test('upload, check, approve and publish a document; members only see it once published', async ({
  page,
}) => {
  // A separate document, so the main constitution used by other tests is not changed.
  const title = `Standing orders ${Date.now()}`;
  const pdf = makeSamplePdf([
    [
      { text: 'STANDING ORDERS', size: 16 },
      { text: '1. Meetings' },
      { text: 'Committee meetings are held every month (pelican).' },
      { text: '3. Minutes' },
      { text: 'The Secretary keeps the minutes of every meeting.' },
    ],
  ]);

  // --- A content reviewer uploads and checks it -------------------------------------------
  await signIn(page, 'reviewer@sample.test');
  await page.goto(`${CHOIR}/manage/content`);
  await page.getByLabel('Document title').fill(title);
  await page.getByRole('button', { name: 'Add document' }).click();
  const form = page.getByRole('form', { name: `Upload a new version of ${title}` });
  await expect(form).toBeVisible();

  // Wrong kinds of file are refused, in the browser and by the server.
  await form
    .getByLabel('Document file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('1. Notes') });
  await form.getByRole('button', { name: 'Upload' }).click();
  await expect(
    form.getByText('Please choose a PDF (.pdf) or Word (.docx) document.'),
  ).toBeVisible();
  await form.getByLabel('Document file').setInputFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html>not a pdf</html>'),
  });
  await form.getByRole('button', { name: 'Upload' }).click();
  await expect(form.getByText('The file is named .pdf but is not a PDF document.')).toBeVisible();

  await form
    .getByLabel('Document file')
    .setInputFiles({ name: 'standing-orders.pdf', mimeType: 'application/pdf', buffer: pdf });
  await form.getByLabel('Name for this version (optional)').fill('First draft');
  await form.getByRole('button', { name: 'Upload' }).click();

  await expect(page.getByRole('heading', { name: /Version 1: First draft/ })).toBeVisible();
  const reviewUrl = page.url();
  await expect(page.getByText('Needs checking.')).toBeVisible();
  await expect(page.getByText(/Check this: Clause 3 follows 1/)).toBeVisible();

  // The guide shows the step, the progress, and jumps to the section to check.
  const progress = page.getByRole('progressbar', { name: 'Progress towards publishing' });
  await expect(progress).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Step 2 of 5' })).toBeVisible();
  await page.getByRole('button', { name: /Go to the next section to check/ }).click();
  await expect(page.locator('li[id^="section-"]:focus')).toContainText('Check this');

  // Back to top appears after scrolling and returns to the version heading. A short window
  // makes sure the page is long enough to scroll on every browser size.
  const size = page.viewportSize();
  await page.setViewportSize({ width: size?.width ?? 390, height: 400 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', { name: 'Back to top' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  await expect(page.locator('#version-title')).toBeFocused();
  if (size) await page.setViewportSize(size);
  await expect(page.getByRole('link', { name: 'Download the original' })).toBeVisible();
  const sendButton = page.getByRole('button', { name: 'Send for approval' });
  await expect(sendButton).toBeDisabled();

  // Correct a heading, then confirm the flagged clause after comparing with the original.
  const meetings = page.getByRole('listitem', { name: 'Section 1. Meetings' });
  await meetings.getByRole('button', { name: 'Edit' }).click();
  await meetings.getByRole('textbox', { name: 'Heading', exact: true }).fill('Committee meetings');
  await meetings.getByRole('button', { name: 'Save section' }).click();
  await expect(page.getByText('Section saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark as checked' }).click();
  await expect(page.getByText('Marked as checked.')).toBeVisible();

  await page.getByLabel('I have compared this text with the original document.').check();
  await sendButton.click();
  await expect(page.getByText('Sent for approval.')).toBeVisible();
  // Reviewers cannot approve.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(
    page.getByText('Waiting for an organisation administrator to approve it.'),
  ).toBeVisible();
  await signOut(page);

  // --- Members cannot see it yet --------------------------------------------------------------
  await signIn(page, 'member@sample.test');
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const organisationId = me.memberships[0].organisationId as string;
  const before = await page.request.get(`/api/v1/organisations/${organisationId}/search?q=pelican`);
  expect((await before.json()).results).toEqual([]);
  await signOut(page);

  // --- An administrator approves, then makes it current ---------------------------------------
  await signIn(page, 'admin@sample.test');
  await page.goto(reviewUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved. You can now make it the current version.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Step 5 of 5' })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '80');
  const makeCurrent = page.getByRole('button', { name: 'Make current' });
  await expect(makeCurrent).toBeDisabled();
  await page.getByLabel('Yes, make this the current constitution.').check();
  await makeCurrent.click();
  await expect(
    page.getByText('This is now the current version that members read.').first(),
  ).toBeVisible();
  await expect(page.getByText(/Made the current version/)).toBeVisible();
  await signOut(page);

  // --- Members now read it, and can download the original ------------------------------------
  await signIn(page, 'member@sample.test');
  await page.goto(`${CHOIR}/search?q=pelican`);
  await page.getByRole('link', { name: /Committee meetings/ }).click();
  await expect(page.getByText('Current approved version')).toBeVisible();
  const original = page.getByRole('link', { name: 'Download the original document' });
  const href = await original.getAttribute('href');
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('application/pdf');
  expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
  // Members cannot reach the review page or its actions.
  await page.goto(reviewUrl);
  await expect(page.getByText(/This area is for organisation administrators/)).toBeVisible();
});
