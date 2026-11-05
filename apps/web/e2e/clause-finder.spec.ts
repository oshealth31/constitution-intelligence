// "Find relevant clauses": what members see when AI answers are switched off (the default).
// CI runs the API in offline mode, so this test makes the page believe AI is off by answering
// the status request itself. The clause search then runs against the real API, which never
// calls an AI for it whatever the setting.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';

// The page's AI status is answered by the test (page.route). In WebKit and Firefox, requests
// from a page controlled by the service worker bypass that, so the worker is kept off here.
test.use({ serviceWorkers: 'block' });

async function signInWithAiOff(page: Page) {
  await page.route('**/organisations/*/ai/status', (route) =>
    route.fulfill({
      json: {
        available: false,
        mode: 'disabled',
        disclaimer: 'Not legal advice.',
        unsupportedMessage: 'Not found.',
        clauseFinder: true,
      },
    }),
  );
  const askedAi: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/ai/ask')) askedAi.push(request.url());
  });
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill('member@sample.test');
  await page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
  return askedAi;
}

test('with AI off, finds the matching clauses word for word instead of asking an AI', async ({
  page,
}) => {
  const askedAi = await signInWithAiOff(page);
  await expect(page.getByRole('link', { name: /Find relevant clauses/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main', exact: true });
  await expect(nav.getByRole('link', { name: 'Ask', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Find clauses' }).click();

  await expect(page.getByRole('heading', { name: 'Find relevant clauses' })).toBeVisible();
  await expect(page.getByText('No AI is used.')).toBeVisible();
  await expect(page.getByText('Written by AI')).toHaveCount(0);

  await page.getByLabel('Your question').fill('What is the quorum for a general meeting?');
  await page.getByRole('button', { name: 'Find clauses' }).click();

  await expect(
    page.getByRole('heading', { name: /matching clauses? from the approved/ }),
  ).toBeVisible();
  const clause = page.getByRole('listitem', { name: 'Clause: Clause 7', exact: true });
  await expect(clause).toContainText('Version 1: Registered constitution');
  await expect(clause.getByTestId('clause-text')).toContainText(
    'The quorum for a general meeting is one third of members',
  );
  await expect(clause.locator('mark').first()).toBeVisible();

  await clause.getByRole('link', { name: 'Open this clause in the constitution' }).click();
  await expect(page).toHaveURL(/#section-s2$/);
  expect(askedAi).toHaveLength(0);
});

test('with AI off, says clearly when no clause matches', async ({ page }) => {
  await signInWithAiOff(page);
  await page.goto(`${CHOIR}/ask`);
  await page.getByLabel('Your question').fill('Who won the football world cup?');
  await page.getByRole('button', { name: 'Find clauses' }).click();
  await expect(page.getByTestId('clauses-message')).toContainText(
    'No matching clauses were found in the approved constitution',
  );
});
