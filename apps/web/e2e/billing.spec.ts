// Stage 10 in a browser: an invoice is issued, the organisation's owner reports a payment, a
// Super Admin verifies it by hand, and the owner sees the receipt. Also: what members see when
// their organisation is suspended. No payment provider is involved anywhere.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';
const NETBALL = '/o/sample-netball-club';

async function superAdminPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill('superadmin@sample.test');
  await page.getByLabel('Password').fill(accounts['superadmin@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return page;
}

async function portalPage(browser: Browser, slug: string, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${slug}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();
  return page;
}

async function openOrganisation(page: Page, name: string) {
  await page.goto('/admin/organisations');
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
}

test('invoice → owner reports payment → Super Admin verifies by hand → receipt', async ({
  browser,
}) => {
  const admin = await superAdminPage(browser);
  await openOrganisation(admin, 'Sample Community Choir (fictional)');
  await admin.getByRole('button', { name: 'Issue an invoice', exact: true }).click();
  const invoiceForm = admin.getByRole('form', { name: 'Issue an invoice' });
  await invoiceForm.getByLabel('Description').fill('Pilot set-up fee (test)');
  await invoiceForm.getByLabel('Amount').fill('150.00');
  await invoiceForm.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(admin.getByText('Invoice issued.')).toBeVisible();

  // The owner sees the invoice, the manual-payment notice, and reports the payment.
  const owner = await portalPage(browser, CHOIR, 'owner@sample.test');
  await owner.goto(`${CHOIR}/manage/subscription`);
  await expect(owner.getByText('Manual payment verification.')).toBeVisible();
  await expect(owner.getByText('Pilot', { exact: true }).first()).toBeVisible();
  const invoice = owner.getByRole('listitem', { name: /^Invoice INV-/ }).first();
  await expect(invoice).toContainText('Pilot set-up fee (test)');
  await expect(invoice).toContainText('BWP 150.00');
  await invoice.getByRole('button', { name: 'Report a payment' }).click();
  await invoice.getByLabel('Payment reference').fill('4111 1111 1111 1111');
  await invoice.getByRole('button', { name: 'Send for verification' }).click();
  await expect(invoice.getByText(/looks like a card number/)).toBeVisible();
  await invoice.getByLabel('Payment reference').fill('EFT CHOIR TEST 001');
  await invoice.getByRole('button', { name: 'Send for verification' }).click();
  await expect(invoice).toContainText('Waiting for verification');
  await expect(invoice.getByTestId('receipt')).toHaveCount(0);

  // The Super Admin verifies it, confirming they saw the money arrive.
  await admin.reload();
  const payment = admin.getByRole('listitem', { name: 'Payment EFT CHOIR TEST 001' });
  await expect(payment).toContainText('Manual verification');
  const verify = payment.getByRole('button', { name: 'Verify payment' });
  await expect(verify).toBeDisabled();
  await payment.getByLabel(/I have checked the bank or mobile-money statement/).check();
  await verify.click();
  await expect(admin.getByText('Payment verified and receipt issued.')).toBeVisible();

  await owner.reload();
  const paid = owner.getByRole('listitem', { name: /^Invoice INV-/ }).first();
  await expect(paid.getByTestId('receipt')).toContainText(/Receipt RCP-\d{4}-\d+/);
  await expect(paid).toContainText('Paid');
});

test('members of a suspended organisation are told the portal is unavailable', async ({
  browser,
}) => {
  const admin = await superAdminPage(browser);
  await openOrganisation(admin, 'Sample Netball Club (fictional)');
  const billing = admin.locator('section', {
    has: admin.getByRole('heading', { name: 'Billing', exact: true }),
  });
  await billing.getByRole('button', { name: 'Suspend', exact: true }).click();
  const form = billing.getByRole('form', { name: 'Suspend subscription' });
  await form.getByLabel(/Reason/).fill('Browser test of suspension');
  await form.getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('Subscription suspended.')).toBeVisible();
  try {
    const member = await (await browser.newContext()).newPage();
    await member.goto(`${NETBALL}/sign-in`);
    await member.getByLabel('Email address').fill('netball.member@sample.test');
    await member.getByLabel('Password').fill(accounts['netball.member@sample.test'] ?? '');
    await member.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      member.getByRole('heading', { name: 'The portal is not available right now' }),
    ).toBeVisible();
    await expect(member.getByTestId('subscription-notice')).toContainText('suspended');
    // The API refuses the content itself, whatever the page shows.
    const refused = await member.request.get(
      `/api/v1/organisations/${await organisationId(member)}/library`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    );
    expect(refused.status()).toBe(403);
  } finally {
    await billing.getByRole('button', { name: 'Reactivate', exact: true }).click();
    const reactivate = billing.getByRole('form', { name: 'Reactivate subscription' });
    await reactivate.getByLabel(/Reason/).fill('Browser test finished');
    await reactivate.getByRole('button', { name: 'Confirm' }).click();
    await expect(admin.getByText('Subscription reactivated.')).toBeVisible();
  }
});

async function organisationId(page: Page): Promise<string> {
  const me = await page.request.get('/api/v1/auth/me');
  const body = (await me.json()) as {
    memberships: { organisationSlug: string; organisationId: string }[];
  };
  return body.memberships.find((item) => item.organisationSlug === 'sample-netball-club')!
    .organisationId;
}
