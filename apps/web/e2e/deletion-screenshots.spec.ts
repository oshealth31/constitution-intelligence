// Helper (not for merging): the organisation deletion process, step by step, with the seeded
// fictional "Sample Netball Club" (which has a constitution, files and members). Saves
// screenshots to apps/web/screenshots/deletion-*.png. Runs only with CAPTURE_SCREENSHOTS=1.
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { accounts, apiFrom } from './qa-helpers';
import { codeForStep, currentStep, freshCode } from './totp';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'Screenshots are only captured on request.');
test.setTimeout(300_000);
test.describe.configure({ retries: 0 });
test.use({ viewport: { width: 1280, height: 900 } });

const OUT = path.join(__dirname, '..', 'screenshots');
const NETBALL = 'Sample Netball Club (fictional)';

async function shot(target: Page | Locator, name: string, fullPage = false) {
  const page = 'page' in target ? target.page() : target;
  await page.waitForTimeout(400);
  if ('page' in target) await target.screenshot({ path: path.join(OUT, `deletion-${name}.png`) });
  else await target.screenshot({ path: path.join(OUT, `deletion-${name}.png`), fullPage });
}

function deletionCard(page: Page, title = "Delete this organisation's data"): Locator {
  return page.locator('section', { has: page.getByRole('heading', { name: title }) }).last();
}

test('organisation deletion, step by step', async ({ browser }) => {
  // The requesting Super Admin.
  const first = await (await browser.newContext()).newPage();
  await first.goto('/admin/sign-in');
  await first.getByLabel('Email address').fill('superadmin@sample.test');
  await first.getByLabel('Password').fill(accounts['superadmin@sample.test'] ?? '');
  await first.getByRole('button', { name: 'Sign in' }).click();
  await first.getByLabel('Authenticator code').fill(await freshCode('superadmin@sample.test'));
  await first.getByRole('button', { name: 'Continue' }).click();
  await expect(first.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  // 1. An active organisation cannot be deleted.
  await first.goto('/admin/organisations');
  await first.getByRole('link', { name: NETBALL, exact: true }).first().click();
  await expect(first.getByRole('heading', { level: 1 })).toContainText(NETBALL);
  const organisationId = first.url().split('/').pop()!;
  const detail = await apiFrom(first, 'GET', `/platform/organisations/${organisationId}`);
  const slug = (detail.body as { organisation: { slug: string } }).organisation.slug;
  await deletionCard(first).scrollIntoViewIfNeeded();
  await expect(deletionCard(first).getByText(/access has ended/)).toBeVisible();
  await shot(deletionCard(first), '01-active-not-allowed');

  // 2. Access is ended first (here: suspended, with a reason).
  const suspend = first.getByRole('form', { name: 'Suspend organisation' });
  await suspend.getByLabel(/Reason/).fill('Pilot ended; the club asked to leave in writing (fictional)');
  await suspend.scrollIntoViewIfNeeded();
  await shot(suspend, '02-suspend-first');
  await suspend.getByRole('button', { name: 'Suspend organisation' }).click();
  await expect(first.getByText(/Organisation suspended/)).toBeVisible();
  await first.reload();

  // 3. The request form, with the preview of what is deleted and kept.
  const form = first.getByRole('form', { name: 'Request deletion' });
  await expect(form).toBeVisible();
  await form.getByLabel(/^Reason/).fill('Pilot ended; owner asked in writing on 3 Nov (fictional)');
  await form.getByRole('checkbox').check();
  await form.getByLabel(/Type the web address/).fill(slug);
  await shot(deletionCard(first), '03-request-filled');
  await form.getByRole('button', { name: 'Request deletion' }).click();

  // 4. Waiting for a different Super Admin.
  await expect(first.getByText('Waiting for another Super Admin to approve it.')).toBeVisible();
  await shot(deletionCard(first), '04-waiting-for-second-person');

  // The second Super Admin (sets up two-step sign-in on first use).
  const second = await (await browser.newContext()).newPage();
  await second.goto('/admin/sign-in');
  await second.getByLabel('Email address').fill('newstaff@sample.test');
  await second.getByLabel('Password').fill(accounts['newstaff@sample.test'] ?? '');
  await second.getByRole('button', { name: 'Sign in' }).click();
  await expect(second.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible();
  const key = ((await second.getByTestId('two-step-setup-key').textContent()) ?? '').replace(
    /\s/g,
    '',
  );
  await second.getByLabel('6-digit code from the app').fill(codeForStep(key, currentStep()));
  await second.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await second.getByRole('button', { name: 'I have saved my recovery codes' }).click();
  await expect(second.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();

  // 5. The second Super Admin sees the request and approves it.
  await second.goto(`/admin/organisations/${organisationId}`);
  const approve = second.getByRole('form', { name: 'Approve deletion' });
  await expect(approve).toBeVisible();
  await approve.getByLabel(/Type the web address/).fill(slug);
  await shot(deletionCard(second), '05-second-person-approves');
  await approve.getByRole('button', { name: 'Delete permanently' }).click();

  // 6. Done: what was deleted, and the billing records that are kept (subscription ended).
  await expect(second.getByRole('heading', { name: 'Data deleted' })).toBeVisible();
  await expect(second.getByText(/subscription has ended/)).toBeVisible();
  await shot(second, '06-deleted', true);

  // 7. The organisations list and the audit log.
  await second.goto('/admin/organisations');
  await expect(second.getByText('Deleted').first()).toBeVisible();
  await shot(second, '07-list-shows-deleted');
  await second.goto(`/admin/audit?organisationId=${organisationId}`);
  await expect(second.getByText(/deleted/i).first()).toBeVisible();
  await shot(second, '08-audit-record');

  // 8. The club's portal address no longer exists.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/o/sample-netball-club/sign-in');
  await visitor.waitForTimeout(1500);
  await shot(visitor, '09-portal-gone');
  // And its former member cannot sign in any more (account deleted).
  await visitor.goto('/o/sample-community-choir/sign-in');
  await visitor.getByLabel('Email address').fill('netball.member@sample.test');
  await visitor.getByLabel('Password').fill(accounts['netball.member@sample.test'] ?? '');
  await visitor.getByRole('button', { name: 'Sign in' }).click();
  await expect(visitor.getByText('Invalid email or password.')).toBeVisible();
  await shot(visitor, '10-former-member-cannot-sign-in');
});
