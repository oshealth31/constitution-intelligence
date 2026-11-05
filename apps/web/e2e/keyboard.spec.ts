// Task T2: the main tasks with the keyboard only (no mouse), with a visible focus outline at
// every stop, plus the names and descriptions screen readers announce for form fields.
// Complements the automatic axe-core scan in qa-mobile-accessibility.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { accounts, enterTwoStepCodeIfNeeded, phone } from './qa-helpers';

const CHOIR = '/o/sample-community-choir';

/** What the keyboard focus is on, as the test sees it. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      text: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 80),
      label: element.labels?.[0]?.textContent?.trim() ?? '',
      // A focus outline, or the focus ring (box-shadow) used on form fields.
      indicator:
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow !== 'none' && style.boxShadow !== ''),
      visible: box.width > 1 && box.height > 1,
    };
  });
}

/** Presses Tab until the focus matches, or fails after `limit` presses. */
async function tabTo(
  page: Page,
  matches: (target: NonNullable<Awaited<ReturnType<typeof focused>>>) => boolean,
  limit = 40,
) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    const target = await focused(page);
    if (target && matches(target)) return target;
  }
  throw new Error(`Focus never reached the expected element in ${limit} Tab presses`);
}

async function signInWithKeyboard(page: Page, email: string) {
  await page.goto(`${CHOIR}/sign-in`);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await tabTo(page, (target) => target.tag === 'input' && /Email address/.test(target.label));
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  expect((await focused(page))?.label).toMatch(/^Password/);
  await page.keyboard.type(accounts[email] ?? '');
  await page.keyboard.press('Enter');
  await expect(page.locator('#welcome-heading')).toBeVisible();
}

test('a member signs in, skips to the content and searches with the keyboard only', async ({
  page,
}) => {
  await signInWithKeyboard(page, 'member@sample.test');

  // The first Tab stop is the "Skip to main content" link, and it becomes visible.
  await page.reload();
  await expect(page.locator('#welcome-heading')).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = await focused(page);
  expect(skip?.text).toBe('Skip to main content');
  expect(skip?.visible).toBe(true);
  await page.keyboard.press('Enter');
  expect((await focused(page))?.id).toBe('main');

  // From the top: the main menu, then Search.
  await page.keyboard.press('Shift+Tab');
  await tabTo(page, (target) => target.tag === 'a' && target.text === 'Search');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search$/);
  await tabTo(page, (target) => target.tag === 'input' && /looking for/.test(target.label));
  await page.keyboard.type('quorum');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/quorum/i).first()).toBeVisible();
  await tabTo(page, (target) => target.tag === 'a' && /Quorum/i.test(target.text));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('note', { name: 'Reference for this section' })).toBeVisible();
});

test('every keyboard stop on the member home page shows where the focus is', async ({ page }) => {
  await signInWithKeyboard(page, 'member@sample.test');
  const missing: string[] = [];
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press('Tab');
    const target = await focused(page);
    if (!target || target.tag === 'body') break;
    if (target.visible && !target.indicator) missing.push(`${target.tag} “${target.text}”`);
  }
  expect(missing).toEqual([]);
});

test('the Control Centre can be used with the keyboard', async ({ page }) => {
  await page.goto('/admin/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await tabTo(page, (target) => target.tag === 'input' && /Email address/.test(target.label));
  await page.keyboard.type('superadmin@sample.test');
  await page.keyboard.press('Tab');
  await page.keyboard.type(accounts['superadmin@sample.test'] ?? '');
  await page.keyboard.press('Enter');
  await enterTwoStepCodeIfNeeded(page, 'superadmin@sample.test');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  await page.keyboard.press('Tab');
  expect((await focused(page))?.text).toBe('Skip to main content');
  await tabTo(page, (target) => target.tag === 'a' && target.text === 'Organisations');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Organisations', level: 1 })).toBeVisible();
});

test('form hints are read as a description, not as part of the field name', async ({ page }) => {
  await page.goto('/reset-password?token=not-a-real-token-for-this-check');
  const field = page.getByLabel('New password', { exact: true });
  await expect(field).toHaveAccessibleName('New password');
  await expect(field).toHaveAccessibleDescription(/At least 12 characters/);
});

test('portal form hints are read as a description too', async ({ page }) => {
  await signInWithKeyboard(page, 'owner@sample.test');
  await page.goto(`${CHOIR}/manage/branding`);
  const field = page.getByLabel('Organisation name (as shown in the portal)');
  await expect(field).toHaveAccessibleName('Organisation name (as shown in the portal)');
  await expect(field).toHaveAccessibleDescription(/Leave empty to use/);
});

test.describe('on a phone', { tag: '@phone' }, () => {
  test.use(phone(390, 844));

  test('the Contents panel keeps the focus inside, closes with Escape and returns the focus', async ({
    page,
  }) => {
    await signInWithKeyboard(page, 'member@sample.test');
    await page.goto(`${CHOIR}/search`);
    await page.getByLabel('What are you looking for?').fill('voting');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: /8\. Voting/ }).click();

    const opener = page.getByRole('button', { name: 'Contents' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Contents' });
    await expect(dialog).toBeVisible();
    expect((await focused(page))?.text).toBe('Close');
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press(step % 5 === 4 ? 'Shift+Tab' : 'Tab');
      expect(await dialog.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
