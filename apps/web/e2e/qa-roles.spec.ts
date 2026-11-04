// Stage 13 QA: roles and permissions in the browser, for every organisation role.
// Positive: each role sees exactly the Manage sections its permissions allow.
// Negative: opening a section directly by its address is refused, and the API refuses the
// same action even when the page is bypassed.
import { expect, test } from '@playwright/test';
import { apiFrom, CHOIR, organisationIdFor, portal, signInPortal } from './qa-helpers';

const ALL = [
  'Branding',
  'Members',
  'Documents',
  'Approved answers',
  'Simple words',
  'Subscription',
  'Portal address',
];

const EXPECTED: Record<string, string[]> = {
  'owner@sample.test': ALL,
  'admin@sample.test': ALL.filter((title) => title !== 'Portal address'),
  'reviewer@sample.test': ['Documents', 'Approved answers', 'Simple words'],
  'auditor@sample.test': ['Members', 'Subscription'],
  'member@sample.test': [],
};

for (const [email, sections] of Object.entries(EXPECTED)) {
  test(`${email.split('@')[0]} sees only the Manage sections the role allows`, async ({ page }) => {
    await signInPortal(page, email);
    await expect(page.locator('#welcome-heading')).toBeVisible();
    if (sections.length === 0) {
      await expect(page.getByRole('link', { name: 'Manage', exact: true })).toHaveCount(0);
      await page.goto(portal(CHOIR.slug, '/manage'));
      await expect(page.getByText('This area is for organisation administrators.')).toBeVisible();
      return;
    }
    await page.goto(portal(CHOIR.slug, '/manage'));
    await expect(page.getByRole('heading', { name: 'Manage', level: 1 })).toBeVisible();
    for (const title of ALL) {
      const link = page.getByRole('link', { name: new RegExp(`^${title}`) });
      if (sections.includes(title)) {
        await expect(link.first()).toBeVisible();
      } else {
        await expect(link).toHaveCount(0);
      }
    }
  });
}

test('a section opened by its address is refused when the role does not include it', async ({
  page,
}) => {
  await signInPortal(page, 'reviewer@sample.test');
  for (const address of ['/manage/subscription', '/manage/members', '/manage/branding']) {
    await page.goto(portal(CHOIR.slug, address));
    await expect(page.getByText('This area is for organisation administrators.')).toBeVisible();
  }
});

test('the API refuses actions outside the role, even without the page', async ({ page }) => {
  await signInPortal(page, 'member@sample.test');
  const id = await organisationIdFor(page, CHOIR.slug);
  const invite = await apiFrom(page, 'POST', `/organisations/${id}/invitations`, {
    email: 'someone.new@sample.test',
    role: 'member',
  });
  expect(invite.status).toBe(403);
  const members = await apiFrom(page, 'GET', `/organisations/${id}/members`);
  expect(members.status).toBe(403);
  const audit = await apiFrom(page, 'GET', `/organisations/${id}/audit-events`);
  expect(audit.status).toBe(403);
  // Reading the constitution is allowed for a member.
  const read = await apiFrom(page, 'GET', `/organisations/${id}/constitutions`);
  expect(read.status).toBe(200);
});

test('an auditor can read but not change anything', async ({ page }) => {
  await signInPortal(page, 'auditor@sample.test');
  const id = await organisationIdFor(page, CHOIR.slug);
  expect((await apiFrom(page, 'GET', `/organisations/${id}/members`)).status).toBe(200);
  expect((await apiFrom(page, 'GET', `/organisations/${id}/audit-events`)).status).toBe(200);
  const invite = await apiFrom(page, 'POST', `/organisations/${id}/invitations`, {
    email: 'auditor.invite@sample.test',
    role: 'member',
  });
  expect(invite.status).toBe(403);
  const upload = await apiFrom(page, 'POST', `/organisations/${id}/constitutions`, {
    title: 'Should not be created',
  });
  expect(upload.status).toBe(403);
});

test('an administrator cannot grant the Owner role', async ({ page }) => {
  await signInPortal(page, 'admin@sample.test');
  const id = await organisationIdFor(page, CHOIR.slug);
  const invite = await apiFrom(page, 'POST', `/organisations/${id}/invitations`, {
    email: 'would.be.owner@sample.test',
    role: 'owner',
  });
  expect(invite.status).toBe(403);
});

test('organisation roles give no access to the Control Centre', async ({ page }) => {
  await signInPortal(page, 'owner@sample.test');
  const overview = await apiFrom(page, 'GET', '/platform/overview');
  expect(overview.status).toBe(403);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'This area is restricted' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toHaveCount(0);
});
