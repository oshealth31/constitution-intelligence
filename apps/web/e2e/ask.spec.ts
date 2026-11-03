// Stage 9: asking questions. CI has no AI account, so the API runs in "offline" mode, which
// points to the best-matching passage instead of writing an explanation. This checks the whole
// flow in a browser: sources, original text, links, unsupported answers and feedback.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';

async function signIn(page: Page) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill('member@sample.test');
  await page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

test('asks a question and shows the explanation apart from the original source text', async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Ask' })
    .click();
  await expect(page.getByText(/It is not legal advice/).first()).toBeVisible();
  await expect(page.getByText(/Test mode: no AI model is connected/)).toBeVisible();

  await page.getByLabel('Your question').fill('What is the quorum for a general meeting?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect(page.getByText('Written by AI · check the original text below')).toBeVisible();
  await expect(page.getByTestId('answer-explanation')).toContainText('Clause 7');
  await expect(
    page.getByRole('heading', { name: 'Original text from the approved constitution' }),
  ).toBeVisible();
  const source = page.getByRole('listitem', { name: 'Source: Clause 7' });
  await expect(source).toContainText('Version 1: Registered constitution');
  await expect(source.locator('mark')).toContainText(
    'The quorum for a general meeting is one third of members',
  );

  await page.getByRole('button', { name: 'No' }).click();
  await page.getByLabel(/What was wrong or missing/).fill('I wanted to know about proxies.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thank you for your feedback.')).toBeVisible();

  await source.getByRole('link', { name: 'Open this section in the constitution' }).click();
  await expect(page).toHaveURL(/#section-s2$/);
  await expect(page.getByRole('note', { name: 'Reference for this section' })).toContainText(
    'Clause 7',
  );
});

test('says clearly when the constitution does not answer the question', async ({ page }) => {
  await signIn(page);
  await page.goto(`${CHOIR}/ask`);
  await page.getByLabel('Your question').fill('Who won the football world cup in 2022?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByTestId('answer-message')).toHaveText(
    'I could not find sufficient information in the approved constitution to answer this question.',
  );
  await expect(page.getByRole('link', { name: 'Search the constitution' })).toBeVisible();
});

test('offers suggested questions taken from the constitution’s own titles', async ({ page }) => {
  await signIn(page);
  await page.goto(`${CHOIR}/ask`);
  const suggestion = page.getByRole('button', {
    name: 'What does the constitution say about quorum?',
  });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page.getByRole('listitem', { name: 'Source: Clause 7' })).toBeVisible();
});
