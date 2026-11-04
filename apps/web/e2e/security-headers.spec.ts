// Stage 12: the strict Content Security Policy is in force and the app still works under it.
// Every page gets its own nonce, nothing on the main pages is blocked by the policy, and an
// injected inline script would not run.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const accounts = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'accounts.json'), 'utf8'),
) as Record<string, string>;
const CHOIR = '/o/sample-community-choir';

/** Collects Content Security Policy violations reported by the browser on this page. */
async function watchViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return violations;
}

test('pages carry a strict policy with a fresh nonce each time', async ({ page }) => {
  const first = await page.goto(`${CHOIR}/sign-in`);
  const second = await page.goto(`${CHOIR}/sign-in`);
  const policyA = first?.headers()['content-security-policy'] ?? '';
  const policyB = second?.headers()['content-security-policy'] ?? '';
  expect(policyA).toContain("script-src 'self' 'nonce-");
  expect(policyA).toContain("frame-ancestors 'none'");
  expect(policyA).toContain("object-src 'none'");
  expect(policyA).not.toContain('unsafe-eval');
  expect(policyA).not.toBe(policyB);
  expect(second?.headers()['x-frame-options']).toBe('DENY');
  expect(second?.headers()['x-content-type-options']).toBe('nosniff');
});

test('the member and admin pages work with no policy violations', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto(`${CHOIR}/sign-in`);
  await page.getByLabel('Email address').fill('owner@sample.test');
  await page.getByLabel('Password').fill(accounts['owner@sample.test'] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#welcome-heading')).toBeVisible();

  for (const address of [
    `${CHOIR}/library`,
    `${CHOIR}/search`,
    `${CHOIR}/ask`,
    `${CHOIR}/manage`,
  ]) {
    await page.goto(address);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test('injected markup cannot run code', async ({ page }) => {
  await page.goto(`${CHOIR}/sign-in`);
  const result = await page.evaluate(async () => {
    const state = window as unknown as { __injected?: boolean };
    // The classic cross-site scripting payload: an inline event handler in injected HTML.
    const box = document.createElement('div');
    box.innerHTML = '<img src="/does-not-exist.png" onerror="window.__injected = true">';
    document.body.appendChild(box);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Turning text into code is refused too.
    let evalWorked = false;
    try {
      evalWorked = (0, eval)('1 + 1') === 2;
    } catch {
      evalWorked = false;
    }
    return { handlerRan: state.__injected === true, evalWorked };
  });
  expect(result).toEqual({ handlerRan: false, evalWorked: false });
});

test('API responses are not stored by the browser', async ({ request }) => {
  const response = await request.get('/api/v1/auth/me');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
});
