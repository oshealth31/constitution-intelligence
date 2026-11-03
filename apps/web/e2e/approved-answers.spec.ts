// Approved answers: an administrator writes an answer, studies it against the original clause,
// approves it, and members then see it (with the "not legal advice" note) when they ask.
// Imported drafts, including AI drafts, are never shown to members until approved.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';

async function signIn(page: Page, email: string) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

test('an administrator writes, studies and approves an answer; members then see it', async ({
  page,
  browser,
}) => {
  await signIn(page, 'admin@sample.test');
  await page.goto(`${CHOIR}/manage/answers`);
  await page.getByRole('button', { name: 'Write a new answer' }).click();
  const form = page.getByRole('form', { name: 'Write a new answer' });
  await form
    .getByLabel('Question, as a member would ask it')
    .fill('How many votes does each member have?');
  await form
    .getByLabel('Answer in everyday words')
    .fill(
      'Each member has one vote. Most decisions are made by a simple majority of the members present.',
    );
  await form.getByLabel('Clauses it is based on').fill('8');
  await form.getByRole('button', { name: 'Save as draft' }).click();

  // The review page: the answer next to the original clause, and the checks.
  await expect(
    page.getByRole('heading', { name: 'How many votes does each member have?' }),
  ).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(
    page.locator('section', { has: page.getByRole('heading', { name: 'Original clauses' }) }),
  ).toContainText('Each member has one vote');
  await expect(page.getByText(/No problems found/)).toBeVisible();

  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/I have read this answer against the original clauses/).check();
  await approve.click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText(/Approved by .* on /)).toBeVisible();

  // A member asks in their own words.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, 'member@sample.test');
  await member.goto(`${CHOIR}/ask`);
  await expect(member.getByRole('heading', { name: 'Common questions' })).toBeVisible();
  await member.getByLabel('Your question').fill('How many votes does a member get?');
  await member.getByRole('button', { name: 'Ask', exact: true }).click();
  const card = member.getByRole('article', {
    name: 'Approved answer: How many votes does each member have?',
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/Approved by Sample Community Choir/);
  await expect(card.getByTestId('approved-answer-text')).toContainText('Each member has one vote.');
  await expect(card).toContainText('Not legal advice.');
  await expect(card.locator('blockquote')).toContainText('Each member has one vote');
  await memberContext.close();
});

test('imported AI drafts are labelled and wait for approval', async ({ page, browser }) => {
  await signIn(page, 'admin@sample.test');
  await page.goto(`${CHOIR}/manage/answers`);
  await page.getByLabel('Choose a .json file').setInputFiles({
    name: 'drafts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        answers: [
          {
            question: 'Who keeps the choir accounts?',
            answer:
              'The Treasurer keeps the accounts and presents them at every annual general meeting.',
            clauses: ['9'],
            draftedBy: 'ai',
          },
        ],
      }),
    ),
  });
  await expect(
    page.getByText(/“drafts.json” has 1 answer, some of them marked as drafted by AI/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import as drafts' }).click();
  await expect(page.getByText(/1 draft imported\. Nothing has been approved\./)).toBeVisible();
  const drafts = page.getByRole('list', { name: 'Draft' });
  await expect(drafts).toContainText('Who keeps the choir accounts?');
  await expect(drafts).toContainText('Drafted by AI');

  await drafts.getByRole('link', { name: 'Who keeps the choir accounts?' }).click();
  await expect(page.getByText('This draft was written by AI.')).toBeVisible();

  // Not visible to members while it is a draft.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signIn(member, 'member@sample.test');
  await member.goto(`${CHOIR}/ask`);
  await member.getByLabel('Your question').fill('Who keeps the choir accounts?');
  await member.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(member.getByText('Was this helpful?')).toBeVisible();
  await expect(member.getByRole('article', { name: /Who keeps the choir accounts/ })).toHaveCount(
    0,
  );
  await memberContext.close();
});

test('content reviewers can write drafts but not approve them', async ({ page }) => {
  await signIn(page, 'reviewer@sample.test');
  await page.goto(`${CHOIR}/manage/answers`);
  await page.getByRole('list', { name: 'Draft' }).getByRole('link').first().click();
  await expect(
    page.getByText('An owner or administrator needs to approve this answer before members see it.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});
