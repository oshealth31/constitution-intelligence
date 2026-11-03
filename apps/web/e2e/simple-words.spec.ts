// Simple words: an administrator writes a plain-language version of a clause and approves it;
// members can then switch on "Simple words" in the reader and see it under the original clause.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';
const SIMPLE =
  'Every member gets one vote. Most decisions need more than half of the members who are there.';

async function signIn(page: Page, email: string) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

test('write, study and approve simple words; members see them under the original', async ({
  page,
  browser,
}) => {
  await signIn(page, 'admin@sample.test');
  await page.goto(`${CHOIR}/manage/simple-words`);
  const clause = page.getByRole('listitem', { name: 'Simple words for Clause 8', exact: true });
  await expect(clause.locator('blockquote')).toContainText('Each member has one vote');
  await clause.getByRole('button', { name: 'Write simple words' }).click();
  await clause.getByLabel('Simple words').fill(SIMPLE);
  await clause.getByRole('button', { name: 'Save as draft' }).click();
  await expect(clause.getByText('Draft', { exact: true })).toBeVisible();
  // "more than half" is not written that way in the clause: a warning for the approver.
  await expect(clause.getByRole('list', { name: 'Check results' })).toContainText('1/2');

  const approve = clause.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeDisabled();
  await clause.getByLabel(/I have read these simple words against the original clause/).check();
  await approve.click();
  await expect(clause.getByText('Approved', { exact: true })).toBeVisible();

  // A member reads the constitution with simple words switched on.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, 'member@sample.test');
  await member.goto(`${CHOIR}/search`);
  await member.getByLabel('What are you looking for?').fill('voting');
  await member.getByRole('button', { name: 'Search', exact: true }).click();
  await member
    .getByRole('link', { name: /8\. Voting/ })
    .first()
    .click();
  const toggle = member.getByRole('button', { name: 'Simple words', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(member.getByLabel('Simple words for Clause 8', { exact: true })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const box = member.getByLabel('Simple words for Clause 8', { exact: true });
  await expect(box).toContainText(SIMPLE);
  await expect(box).toContainText('the original wording above is what counts');
  await expect(member.getByRole('note').filter({ hasText: 'not legal advice' })).toBeVisible();
  // The original wording is still there.
  await expect(
    member.locator('p', { hasText: 'Each member has one vote. Decisions are made' }).first(),
  ).toBeVisible();
  await memberContext.close();
});
