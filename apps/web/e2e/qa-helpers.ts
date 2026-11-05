// Shared helpers for the Stage 13 QA browser tests. Accounts are the fictional ones created by
// global-setup (the development seed): two organisations, every role, and a Super Admin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { freshCode, twoStepKeys } from './totp';

export const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;

export const CHOIR = { slug: 'sample-community-choir', name: 'Sample Community Choir' } as const;
export const NETBALL = { slug: 'sample-netball-club', name: 'Sample Netball Club' } as const;

export function portal(slug: string, rest = ''): string {
  return `/o/${slug}${rest}`;
}

/** Signs in on an organisation's portal and waits for the signed-in home page. */
export async function signInPortal(page: Page, email: string, slug: string = CHOIR.slug) {
  await page.goto(portal(slug, '/sign-in'));
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/sign-in'));
}

/** The second sign-in step, for seeded accounts that have two-step sign-in. */
export async function enterTwoStepCodeIfNeeded(page: Page, email: string) {
  if (!twoStepKeys()[email]) return;
  const field = page.getByLabel('Authenticator code');
  await expect(field).toBeVisible();
  await field.fill(await freshCode(email));
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Signs in to the Control Centre as the Super Admin. */
export async function signInControlCentre(page: Page, email = 'superadmin@sample.test') {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(accounts[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await enterTwoStepCodeIfNeeded(page, email);
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

/** Calls the API from the signed-in browser (same cookies), as the web app would. */
export async function apiFrom(page: Page, method: 'GET' | 'POST', address: string, body?: unknown) {
  return page.evaluate(
    async ({ method, address, body }) => {
      const response = await fetch(`/api/v1${address}`, {
        method,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      };
    },
    { method, address, body },
  );
}

/** The signed-in person's membership of one organisation, from /auth/me. */
export async function organisationIdFor(page: Page, slug: string): Promise<string> {
  const me = await apiFrom(page, 'GET', '/auth/me');
  const memberships = (
    me.body as { memberships: { organisationSlug: string; organisationId: string }[] }
  ).memberships;
  const found = memberships.find((item) => item.organisationSlug === slug);
  if (!found) throw new Error(`Not a member of ${slug}`);
  return found.organisationId;
}

/**
 * Phone-sized screen options for test.use (Task T1). Firefox has no "mobile" mode, so there
 * only the screen size and touch are set; the iPhone and Android runs use their own device.
 */
export function phone(width: number, height: number) {
  const firefox = process.env.E2E_BROWSER === 'firefox';
  return { viewport: { width, height }, hasTouch: true, ...(firefox ? {} : { isMobile: true }) };
}
