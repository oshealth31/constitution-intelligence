// Task D3 in a browser: the Control Centre's deletion card. A new fictional organisation is
// created, suspended, and a deletion is requested and then cancelled. The seed has two Super
// Admins, so the requester sees that a different Super Admin must approve. The deletion itself
// (and the 24-hour rule) is tested in the API tests and the deployment check.
import { expect, test } from '@playwright/test';
import { apiFrom, signInControlCentre } from './qa-helpers';

test('requesting and cancelling a deletion in the Control Centre', async ({ page }) => {
  const name = `E2E Deletion Club ${Date.now()} (fictional)`;
  await signInControlCentre(page);
  await page.goto('/admin/organisations');
  await page.getByRole('button', { name: 'New organisation' }).click();
  await page.getByLabel('Organisation name').fill(name);
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  const organisationId = page.url().split('/').pop()!;
  const detail = await apiFrom(page, 'GET', `/platform/organisations/${organisationId}`);
  const slug = (detail.body as { organisation: { slug: string } }).organisation.slug;

  const status = page.getByRole('form', { name: 'Suspend organisation' });
  await status.getByLabel(/Reason/).fill('End-to-end test of deletion (fictional)');
  await status.getByRole('button', { name: 'Suspend organisation' }).click();
  await expect(page.getByText(/Organisation suspended/)).toBeVisible();
  await page.reload();

  const form = page.getByRole('form', { name: 'Request deletion' });
  await expect(form).toBeVisible();
  const request = form.getByRole('button', { name: 'Request deletion' });
  await form.getByLabel(/^Reason/).fill('Browser test: pilot ended (fictional organisation)');
  await expect(request).toBeDisabled();
  await form.getByRole('checkbox').check();
  await form.getByLabel(/Type the web address/).fill('not-the-address');
  await expect(request).toBeDisabled();
  await form.getByLabel(/Type the web address/).fill(slug);
  await request.click();

  await expect(page.getByText('Deletion requested. Nothing has been deleted yet.')).toBeVisible();
  await expect(page.getByText('Waiting for another Super Admin to approve it.')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Approve deletion' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel the request' }).click();
  await expect(page.getByText('Deletion request cancelled.')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Request deletion' })).toBeVisible();
  // Nothing was deleted.
  const after = await apiFrom(page, 'GET', `/platform/organisations/${organisationId}`);
  expect(
    (after.body as { organisation: { deletedAt: string | null } }).organisation.deletedAt,
  ).toBeNull();
});
