// Organisation portals, driven through a real browser against the real API and database.
// Uses the two fictional organisations created by the development seed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { phone } from './qa-helpers';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;

const CHOIR = '/o/sample-community-choir';
const NETBALL = '/o/sample-netball-club';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
// A valid 1×1 PNG image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function portalSignIn(page: Page, portal: string, email: string) {
  await page.goto(`${portal}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

async function headerColour(page: Page): Promise<string> {
  return page
    .locator('header')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function myOrganisationId(page: Page): Promise<string> {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  return me.memberships[0].organisationId as string;
}

test('each organisation has its own branded sign-in page from the same code', async ({ page }) => {
  await page.goto(`${CHOIR}/sign-in`);
  await expect(page.getByText('Sample Community Choir', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Sample Community Choir logo' })).toBeVisible();
  expect(await headerColour(page)).toBe('rgb(74, 43, 107)');

  await page.goto(`${NETBALL}/sign-in`);
  await expect(page.getByText('Sample Netball Club', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Sample Netball Club logo' })).toBeVisible();
  expect(await headerColour(page)).toBe('rgb(14, 90, 58)');

  await page.goto('/o/no-such-organisation');
  await expect(page.getByRole('heading', { name: 'We could not find this portal' })).toBeVisible();
});

test("a short link forwards to the portal; the site's own pages are untouched", async ({
  page,
}) => {
  await page.goto('/sample-community-choir?from=whatsapp');
  await expect(page).toHaveURL(/\/o\/sample-community-choir\?from=whatsapp$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const response = await page.request.get('/sample-netball-club', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()['location']).toMatch(/\/o\/sample-netball-club$/);

  // Reserved words and real pages are never forwarded.
  const offline = await page.request.get('/offline', { maxRedirects: 0 });
  expect(offline.status()).toBe(200);
  const admin = await page.request.get('/admin', { maxRedirects: 0 });
  expect(admin.headers()['location'] ?? '').not.toContain('/o/admin');
});

test('a member reads, navigates and searches the constitution', async ({ page }) => {
  await portalSignIn(page, CHOIR, 'member@sample.test');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Sample Community Choir' }),
  ).toBeVisible();
  await expect(page.getByTestId('welcome-message')).toContainText('Welcome to our choir');

  await page.getByRole('link', { name: 'Read the constitution' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Constitution of Sample Community Choir',
  );
  await expect(page.getByText('Part 3 · Meetings and decisions').last()).toBeVisible();
  // Members see the published version only: no version picker, no draft warning.
  await expect(page.getByLabel('Version')).toHaveCount(0);
  await expect(page.getByText('Draft wording')).toHaveCount(0);

  const contents = page.getByRole('navigation', { name: 'Contents' });
  await contents.getByRole('link', { name: '7. Quorum' }).click();
  await expect(page).toHaveURL(/#section-s2$/);
  await expect(page.locator('#section-s2')).toBeInViewport();

  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Search' })
    .click();
  await page.getByLabel('What are you looking for?').fill('quorum');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/result.* for “quorum”/)).toBeVisible();
  await expect(page.locator('mark').first()).toHaveText(/quorum/i);
  await page.getByRole('link', { name: /7\. Quorum/ }).click();
  await expect(page).toHaveURL(/#section-s2$/);
  await expect(page.locator('#section-s2')).toBeInViewport();

  // Larger text for easier reading.
  await page.getByRole('button', { name: 'Larger text' }).click();
  await expect(page.locator('article')).toHaveClass(/text-xl/);
});

test("members of one organisation cannot open another organisation's portal", async ({ page }) => {
  await portalSignIn(page, CHOIR, 'member@sample.test');
  const choirId = await myOrganisationId(page);
  await page.request.post('/api/v1/auth/logout', { headers: CSRF });

  await portalSignIn(page, NETBALL, 'netball.member@sample.test');
  await expect(page.getByRole('heading', { name: 'Welcome to Sample Netball Club' })).toBeVisible();
  expect(await headerColour(page)).toBe('rgb(14, 90, 58)');

  await page.goto(CHOIR);
  await expect(
    page.getByRole('heading', { name: 'You are not a member of Sample Community Choir' }),
  ).toBeVisible();
  await expect(page.getByText('Welcome to our choir')).toHaveCount(0);

  // The API refuses too, revealing nothing about the other organisation.
  for (const url of ['/portal', '/library', '/search?q=quorum', '/branding', '/members']) {
    const response = await page.request.get(`/api/v1/organisations/${choirId}${url}`);
    expect(response.status(), url).toBe(404);
    expect(await response.text(), url).not.toContain('nightingale');
  }
});

test('members do not get the manage area, and the API refuses their changes', async ({ page }) => {
  await portalSignIn(page, CHOIR, 'member@sample.test');
  await expect(page.getByRole('link', { name: 'Manage' })).toHaveCount(0);
  await page.goto(`${CHOIR}/manage/branding`);
  await expect(page.getByText(/This area is for organisation administrators/)).toBeVisible();

  const choirId = await myOrganisationId(page);
  const response = await page.request.patch(`/api/v1/organisations/${choirId}/branding`, {
    headers: CSRF,
    data: { welcomeMessage: 'Changed by a member' },
  });
  expect(response.status()).toBe(403);
});

test('an administrator changes branding, and unsafe content stays harmless', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await portalSignIn(page, CHOIR, 'admin@sample.test');
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Manage' })
    .click();
  await page
    .getByRole('link', { name: /Branding/ })
    .first()
    .click();

  const payload =
    '<img src=x onerror="window.__portalXss=1"><script>window.__portalXss=2</script> Rehearsals are on Tuesdays.';
  await page.getByLabel('Welcome message').fill(payload);
  await page.getByLabel('Accent colour', { exact: true }).fill('#C0392B');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Branding saved.')).toBeVisible();

  // SVG and disguised files are refused; a real PNG is accepted.
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(page.getByText(/Other files, including SVG, are not accepted/)).toBeVisible();
  await fileInput.setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  });
  await expect(page.getByText(/must be a PNG, JPEG or WebP image/)).toBeVisible();
  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByText('Logo updated.')).toBeVisible();
  await expect(page.locator('header img').first()).toHaveAttribute(
    'src',
    /^\/api\/v1\/portal\/sample-community-choir\/logo\?v=/,
  );

  // The welcome message is shown exactly as typed, as text, and nothing in it runs.
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Home' })
    .click();
  await expect(page.getByTestId('welcome-message')).toHaveText(payload);
  await expect(page.getByTestId('welcome-message').locator('img, script')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __portalXss?: number }).__portalXss),
  ).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(
    await page
      .locator('header')
      .first()
      .evaluate((el) => getComputedStyle(el.querySelector('.h-1')!).backgroundColor),
  ).toBe('rgb(192, 57, 43)');
});

test('a content reviewer sees the approval status of every version', async ({ page }) => {
  await portalSignIn(page, CHOIR, 'reviewer@sample.test');
  await page.goto(`${CHOIR}/manage/content`);
  await expect(page.getByText('Version 2: Proposed amendment (draft)')).toBeVisible();
  await expect(page.getByText('Version 1: Registered constitution')).toBeVisible();
  await expect(page.getByText(/Latest review: Approved by Choir Owner/)).toBeVisible();
  // Reviewers can open the draft, clearly labelled as not published.
  await page.getByRole('link', { name: 'Open this version' }).first().click();
  await expect(page.getByText(/not published, so ordinary members cannot see it/)).toBeVisible();
  // Reviewers cannot change branding or the portal address.
  await page.goto(`${CHOIR}/manage/address`);
  await expect(page.getByText(/This area is for organisation administrators/)).toBeVisible();
});

test.describe('on a phone', { tag: '@phone' }, () => {
  test.use(phone(390, 844));

  test('large bottom navigation and a Contents button make the portal easy to use', async ({
    page,
  }) => {
    await portalSignIn(page, NETBALL, 'netball.member@sample.test');
    const bottom = page.getByRole('navigation', { name: 'Main (bottom)' });
    await expect(bottom).toBeVisible();
    for (const label of ['Home', 'Read', 'Search', 'Profile']) {
      await expect(bottom.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden();

    await bottom.getByRole('link', { name: 'Read' }).click();
    await expect(bottom.getByRole('link', { name: 'Read' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page
      .getByRole('link', { name: /^Read / })
      .first()
      .click();
    await page.getByRole('button', { name: 'Contents' }).click();
    const sheet = page.getByRole('dialog', { name: 'Contents' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: '10. Changing this constitution' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/#section-amendments$/);

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});
