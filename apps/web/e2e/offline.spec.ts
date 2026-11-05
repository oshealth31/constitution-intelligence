// Stage 11: online ↔ offline in a real browser (Chromium, with the service worker).
// Save for offline reading → go offline → the portal opens the saved copy (navigation, version,
// last synchronisation, local search, AI notice) → back online → it checks for updates →
// remove the copy. Also: nothing from /api or /admin is cached, and signing out clears it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const SLUG = 'sample-community-choir';
const CHOIR = `/o/${SLUG}`;

async function signIn(page: Page) {
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill('member@sample.test');
  await page.getByLabel('Password').fill(accounts['member@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function saveForOffline(page: Page) {
  // The service worker must be running before the reader page can be kept for offline use.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const card = page.getByRole('region', { name: 'Read without internet' }).or(
    page.locator('section', {
      has: page.getByRole('heading', { name: 'Read without internet' }),
    }),
  );
  await card.getByRole('button', { name: 'Save for offline reading' }).click();
  await expect(
    card.getByText('Saved. You can now read the constitution without the internet.'),
  ).toBeVisible();
  await expect(card.getByTestId('offline-saved')).toContainText('last synchronised');
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
}

async function goOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

test('save for offline reading, read and search offline, then sync when back online', { tag: '@phone' }, async ({
  page,
  context,
}) => {
  await signIn(page);
  await saveForOffline(page);

  // Only static files and the offline reader page are cached: never the API or the control centre.
  const cached = await cachedUrls(page);
  expect(cached).toContain(`/offline/${SLUG}`);
  expect(cached.some((url) => url.startsWith('/api/'))).toBe(false);
  expect(cached.some((url) => url.startsWith('/admin'))).toBe(false);
  expect(cached.some((url) => url.includes('/sign-in'))).toBe(false);

  // While on an online page, losing the connection is shown straight away.
  await goOffline(context, page);
  await expect(page.getByTestId('offline-banner')).toContainText('You are offline.');

  // Opening the portal without a connection opens the saved copy.
  await page.goto(`${CHOIR}/library`);
  await expect(page).toHaveURL(new RegExp(`/offline/${SLUG}$`));
  await expect(page.getByTestId('connection-status')).toHaveText('Offline');
  await expect(page.getByText('You are reading the copy saved on this device.')).toBeVisible();
  await expect(page.getByTestId('last-sync')).toContainText('Last synchronised');
  await expect(page.getByTestId('offline-version')).toContainText('Version 1');
  await expect(
    page.getByText(/Questions answered by AI need an internet connection/),
  ).toBeVisible();

  // Navigate by the contents.
  await page
    .getByRole('navigation', { name: 'Contents' })
    .getByRole('button', { name: /Quorum/ })
    .first()
    .click();
  await expect(
    page.getByText('The quorum for a general meeting is one third of members').first(),
  ).toBeInViewport();

  // Search on the device.
  await page.getByRole('textbox', { name: 'Search the saved copy' }).fill('quorum');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const results = page.getByRole('region', { name: 'Search results' });
  await expect(results).toContainText(/match/);
  await expect(results.getByRole('button').first()).toContainText('Clause 7');
  await page.getByRole('textbox', { name: 'Search the saved copy' }).fill('zebra helicopter');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(results).toContainText('Nothing in the saved copy matches');

  // Back online: the copy is checked against the server.
  await context.setOffline(false);
  await expect(page.getByTestId('connection-status')).toHaveText('Online');
  await expect(page.getByText('The saved copy is up to date.')).toBeVisible();

  // Remove it safely.
  await page.getByRole('button', { name: 'Remove the saved copy from this device' }).click();
  await page.getByRole('button', { name: 'Yes, remove it from this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Nothing saved for offline reading' }),
  ).toBeVisible();
  expect(await cachedUrls(page)).not.toContain(`/offline/${SLUG}`);
});

test('the Ask page explains that live AI does not work offline', { tag: '@phone' }, async ({ page, context }) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Ask' })
    .click();
  await expect(page.getByLabel('Your question')).toBeVisible();
  await goOffline(context, page);
  await expect(
    page.getByText(/Live AI answers and “find relevant clauses” need an internet connection/),
  ).toBeVisible();
  await expect(page.getByLabel('Your question')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByLabel('Your question')).toBeVisible();
});

test('signing out removes the saved copy from the device', { tag: '@phone' }, async ({ page }) => {
  await signIn(page);
  await saveForOffline(page);
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'My profile' })
    .click();
  await page
    .getByRole('button', { name: /^Sign out/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${CHOIR}/sign-in`));
  await page.goto(`/offline/${SLUG}`);
  await expect(
    page.getByRole('heading', { name: 'Nothing saved for offline reading' }),
  ).toBeVisible();
});
