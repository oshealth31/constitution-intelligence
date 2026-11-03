// Stage 8: searching by clause number and title, helpful no-results messages, clause references
// and moving between sections in the reader.
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

async function search(page: Page, query: string) {
  await page.goto(`${CHOIR}/search`);
  await page.getByLabel('What are you looking for?').fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test('finds a clause by number and shows its reference, version and neighbours', async ({ page }) => {
  await signIn(page);
  await search(page, 'clause 2');
  await expect(page.getByText(/looking for Clause 2/)).toBeVisible();
  const result = page.getByRole('link', { name: /2\. Objectives/ }).first();
  await expect(result).toContainText('Registered constitution');
  await expect(result).toContainText('Part 1 · Name and objectives');
  await result.click();

  await expect(page.getByText('Version 1: Registered constitution')).toBeVisible();
  const reference = page.getByRole('note', { name: 'Reference for this section' });
  await expect(reference).toContainText(
    'Constitution of Sample Community Choir (fictional), Registered constitution (version 1), Clause 2',
  );
  await expect(page.getByText(/Words from your search “clause 2” are highlighted/)).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Section navigation' });
  await navigation.getByRole('button', { name: /^Next section/ }).click();
  await expect(reference).toContainText('Part 2');
  await navigation.getByRole('button', { name: /^Previous section/ }).click();
  await expect(reference).toContainText('Clause 2');

  await page.getByRole('link', { name: 'Back to search results' }).click();
  await expect(page.getByLabel('What are you looking for?')).toHaveValue('clause 2');
});

test('finds lettered sub-clauses by reference', async ({ page }) => {
  await signIn(page);
  await search(page, '2(a)');
  await page.getByRole('link', { name: /Clause 2\(a\)/ }).first().click();
  await expect(page.getByRole('note', { name: 'Reference for this section' })).toContainText('Clause 2(a)');
});

test('gives helpful messages when nothing is found', async ({ page }) => {
  await signIn(page);
  await search(page, 'clause 99');
  await expect(page.getByText('There is no clause 99 in the current constitution.')).toBeVisible();

  await search(page, 'quorom');
  await expect(page.getByText('Nothing found for “quorom”.')).toBeVisible();
  await expect(page.getByText(/To find a clause by number/)).toBeVisible();
  await page.getByRole('button', { name: 'Quorum' }).click();
  await expect(page.getByRole('link', { name: /7\. Quorum/ })).toBeVisible();
  await expect(page.locator('mark').first()).toHaveText(/quorum/i);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('moves between sections with large buttons', async ({ page }) => {
    await signIn(page);
    await search(page, 'voting');
    await page.getByRole('link', { name: /8\. Voting/ }).click();
    const navigation = page.getByRole('navigation', { name: 'Section navigation' });
    await expect(navigation.getByRole('button', { name: /^Previous section/ })).toBeVisible();
    await expect(navigation.getByRole('button', { name: /^Next section/ })).toBeVisible();
    await expect(page.getByRole('note', { name: 'Reference for this section' })).toContainText('Clause 8');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
