// Stage 13 QA: two fictional organisations kept apart in the browser, and how the app
// behaves when things go wrong (wrong password, unknown portal, expired session, bad links,
// unknown API addresses). Negative cases on purpose.
import { expect, test } from '@playwright/test';
import { apiFrom, CHOIR, NETBALL, organisationIdFor, portal, signInPortal } from './qa-helpers';

test.describe('tenant isolation', () => {
  test('a choir member cannot open the netball club portal', async ({ page }) => {
    await signInPortal(page, 'member@sample.test');
    await page.goto(portal(NETBALL.slug));
    await expect(
      page.getByRole('heading', { name: `You are not a member of ${NETBALL.name}` }),
    ).toBeVisible();
    await expect(page.locator('#welcome-heading')).toHaveCount(0);
  });

  test('a netball member cannot open the choir portal', async ({ page }) => {
    await signInPortal(page, 'netball.member@sample.test', NETBALL.slug);
    await page.goto(portal(CHOIR.slug, '/library'));
    await expect(
      page.getByRole('heading', { name: `You are not a member of ${CHOIR.name}` }),
    ).toBeVisible();
  });

  test('the API refuses another organisation’s data with "not found"', async ({ browser }) => {
    // Learn the netball club's ID as one of its members…
    const netball = await browser.newContext();
    const netballPage = await netball.newPage();
    await signInPortal(netballPage, 'netball.owner@sample.test', NETBALL.slug);
    const netballId = await organisationIdFor(netballPage, NETBALL.slug);
    await netball.close();

    // …then try it as the choir's owner, who has the most rights in the choir.
    const choir = await browser.newContext();
    const page = await choir.newPage();
    await signInPortal(page, 'owner@sample.test');
    for (const address of [
      `/organisations/${netballId}`,
      `/organisations/${netballId}/constitutions`,
      `/organisations/${netballId}/members`,
      `/organisations/${netballId}/search?q=meeting`,
      `/organisations/${netballId}/offline/bundle`,
      `/organisations/${netballId}/audit-events`,
    ]) {
      const response = await apiFrom(page, 'GET', address);
      expect(response.status, address).toBe(404);
    }
    const write = await apiFrom(page, 'POST', `/organisations/${netballId}/invitations`, {
      email: 'cross.tenant@sample.test',
      role: 'member',
    });
    expect(write.status).toBe(404);
    await choir.close();
  });
});

test.describe('error handling', () => {
  test('a wrong password shows a clear message and does not sign in', async ({ page }) => {
    await page.goto(portal(CHOIR.slug, '/sign-in'));
    await page.getByLabel('Email address').fill('member@sample.test');
    await page.getByLabel('Password').fill('definitely the wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('an empty sign-in form is not sent', async ({ page }) => {
    await page.goto(portal(CHOIR.slug, '/sign-in'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    const valid = await page
      .getByLabel('Email address')
      .evaluate((input) => (input as HTMLInputElement).validity.valid);
    expect(valid).toBe(false);
  });

  test('an unknown portal address says so', async ({ page }) => {
    await page.goto('/o/no-such-organisation-here');
    await expect(page.getByText('We could not find this portal')).toBeVisible();
  });

  test('when the session ends, the next page asks to sign in again', async ({ page, context }) => {
    await signInPortal(page, 'member@sample.test');
    await expect(page.locator('#welcome-heading')).toBeVisible();
    await context.clearCookies();
    await page.goto(portal(CHOIR.slug, '/search'));
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a made-up password-reset link is refused politely', async ({ page }) => {
    await page.goto('/reset-password?token=this-is-not-a-real-reset-token-at-all');
    await page.getByLabel(/^New password/).fill('a brand new long passphrase');
    await page.getByLabel('Confirm new password').fill('a brand new long passphrase');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'This password reset link is invalid or has expired.' }),
    ).toBeVisible();
  });

  test('unknown API addresses answer with a structured error, not a stack trace', async ({
    request,
  }) => {
    const response = await request.get('/api/v1/this/does/not/exist');
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(body)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
  });
});
