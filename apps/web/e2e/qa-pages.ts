// The pages the QA layout and accessibility checks visit, grouped by who can see them.
import { expect, type Page } from '@playwright/test';
import { CHOIR, portal, signInControlCentre, signInPortal } from './qa-helpers';

export interface PageGroup {
  who: string;
  signIn?: (page: Page) => Promise<void>;
  /** Address, or a function that finds it (for example the reader of the first constitution). */
  pages: { name: string; address: string | ((page: Page) => Promise<string>) }[];
}

async function firstReaderAddress(page: Page): Promise<string> {
  await page.goto(portal(CHOIR.slug, '/library'));
  const link = page.locator('a[href*="/read/"]').first();
  await expect(link).toBeVisible();
  return (await link.getAttribute('href')) ?? portal(CHOIR.slug, '/library');
}

export const PAGE_GROUPS: PageGroup[] = [
  {
    who: 'not signed in',
    pages: [
      { name: 'Portal sign-in', address: portal(CHOIR.slug, '/sign-in') },
      { name: 'Control Centre sign-in', address: '/admin/sign-in' },
      { name: 'Forgot password', address: '/forgot-password' },
      { name: 'Unknown portal', address: '/o/no-such-organisation-here' },
      { name: 'Portal finder', address: '/' },
    ],
  },
  {
    who: 'member',
    signIn: (page) => signInPortal(page, 'member@sample.test'),
    pages: [
      { name: 'Home', address: portal(CHOIR.slug) },
      { name: 'Library', address: portal(CHOIR.slug, '/library') },
      { name: 'Reader', address: firstReaderAddress },
      { name: 'Search results', address: portal(CHOIR.slug, '/search?q=meeting') },
      { name: 'Ask', address: portal(CHOIR.slug, '/ask') },
      { name: 'Profile', address: portal(CHOIR.slug, '/profile') },
    ],
  },
  {
    who: 'owner',
    signIn: (page) => signInPortal(page, 'owner@sample.test'),
    pages: [
      { name: 'Manage', address: portal(CHOIR.slug, '/manage') },
      { name: 'Documents', address: portal(CHOIR.slug, '/manage/content') },
      { name: 'Members', address: portal(CHOIR.slug, '/manage/members') },
      { name: 'Branding', address: portal(CHOIR.slug, '/manage/branding') },
      { name: 'Approved answers', address: portal(CHOIR.slug, '/manage/answers') },
      { name: 'Simple words', address: portal(CHOIR.slug, '/manage/simple-words') },
      { name: 'Subscription', address: portal(CHOIR.slug, '/manage/subscription') },
      { name: 'Portal address', address: portal(CHOIR.slug, '/manage/address') },
    ],
  },
  {
    who: 'super admin',
    signIn: (page) => signInControlCentre(page),
    pages: [
      { name: 'Overview', address: '/admin' },
      { name: 'Organisations', address: '/admin/organisations' },
      { name: 'Billing', address: '/admin/billing' },
      { name: 'Plans', address: '/admin/plans' },
      { name: 'Audit log', address: '/admin/audit' },
      { name: 'System health', address: '/admin/health' },
    ],
  },
];

/** Opens a page and waits until its main content has loaded (no loading spinner left). */
export async function openPage(page: Page, address: string) {
  await page.goto(address);
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.getByText(/^(Loading|Checking your access)/)).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.waitForLoadState('networkidle');
}
