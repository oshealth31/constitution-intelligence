import { expect, test } from '@playwright/test';

// The page an invitation email links to (/invitations/accept?token=…). Acceptance itself
// (accounts, memberships, wrong person, expiry) is tested against the real API in
// apps/api/test/access.e2e.spec.ts; here the page's own behaviour is checked.

test('a bad or used invitation link shows a clear message from the API', async ({ page }) => {
  await page.goto('/invitations/accept?token=not-a-real-invitation-token-0000000000');
  await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
  await page.getByLabel('Your full name').fill('Test Person');
  await page.getByLabel('Password', { exact: true }).fill('a long enough test password');
  await page.getByLabel('Confirm password').fill('a long enough test password');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page.getByRole('alert')).toContainText(/invitation/i);
});

test('a link without its token says so', async ({ page }) => {
  await page.goto('/invitations/accept');
  await expect(page.getByText('This link is incomplete')).toBeVisible();
});

test('accepting creates the account and opens the organisation portal', async ({ page }) => {
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/v1/invitations/accept', async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        organisationId: '00000000-0000-0000-0000-000000000000',
        organisationSlug: 'sample-community-choir',
        role: 'owner',
      }),
    });
  });
  await page.goto('/invitations/accept?token=sample-token-for-the-page-test-000000');
  await page.getByLabel('Your full name').fill('Test Person');
  await page.getByLabel('Password', { exact: true }).fill('a long enough test password');
  await page.getByLabel('Confirm password').fill('a long enough test password');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page).toHaveURL(/\/o\/sample-community-choir/);
  expect(sent).toEqual({
    token: 'sample-token-for-the-page-test-000000',
    displayName: 'Test Person',
    password: 'a long enough test password',
  });
});

test('signed in as someone else: the page offers to sign out', async ({ page }) => {
  await page.route('**/api/v1/invitations/accept', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'This invitation was sent to a different email address.' },
      }),
    }),
  );
  await page.goto('/invitations/accept?token=sample-token-for-the-page-test-000000');
  await page.getByRole('button', { name: 'I already have an account' }).click();
  await expect(page.getByText('signed in with a different account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('passwords that do not match are caught before sending', async ({ page }) => {
  await page.goto('/invitations/accept?token=sample-token-for-the-page-test-000000');
  await page.getByLabel('Your full name').fill('Test Person');
  await page.getByLabel('Password', { exact: true }).fill('a long enough test password');
  await page.getByLabel('Confirm password').fill('a different test password!');
  await page.getByRole('button', { name: 'Create account and join' }).click();
  await expect(page.getByRole('alert')).toContainText('do not match');
});
