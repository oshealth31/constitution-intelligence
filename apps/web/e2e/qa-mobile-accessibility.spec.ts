// Stage 13 QA: mobile layout and accessibility across the main pages, for visitors, members,
// owners and the Super Admin.
// - On a 360 × 740 phone screen, no page may scroll sideways.
// - Every page is scanned with axe-core against WCAG 2.1 A and AA. "Serious" and "critical"
//   problems fail the test; every finding is printed so the QA report can list it.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openPage, PAGE_GROUPS } from './qa-pages';

for (const group of PAGE_GROUPS) {
  test.describe(`${group.who}: phone layout`, () => {
    test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

    test(`${group.who} pages fit a phone screen`, async ({ page }) => {
      if (group.signIn) await group.signIn(page);
      const overflowing: string[] = [];
      for (const item of group.pages) {
        const address = typeof item.address === 'string' ? item.address : await item.address(page);
        await openPage(page, address);
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (sideways > 1) {
          // Name the widest elements, so the cause can be found from the report.
          const culprits = await page.evaluate(() => {
            const limit = document.documentElement.clientWidth;
            return [...document.querySelectorAll('body *')]
              .map((element) => ({ element, right: element.getBoundingClientRect().right }))
              .filter((item) => item.right > limit + 1)
              .sort((a, b) => b.right - a.right)
              .slice(0, 4)
              .map(
                ({ element, right }) =>
                  `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} (right ${Math.round(right)})`,
              );
          });
          overflowing.push(`${item.name} (${sideways}px too wide: ${culprits.join(' | ')})`);
        }
      }
      console.log(`[qa-mobile] ${group.who}: ${JSON.stringify(overflowing)}`);
      expect(overflowing).toEqual([]);
    });
  });

  test.describe(`${group.who}: accessibility`, () => {
    test(`${group.who} pages have no serious accessibility problems`, async ({ page }) => {
      if (group.signIn) await group.signIn(page);
      const serious: string[] = [];
      for (const item of group.pages) {
        const address = typeof item.address === 'string' ? item.address : await item.address(page);
        await openPage(page, address);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const violation of results.violations) {
          const line = `${item.name}: ${violation.id} [${violation.impact}] ×${violation.nodes.length} – ${violation.help} – e.g. ${violation.nodes[0]?.target.join(' ')}`;
          console.log(`[qa-a11y] ${group.who}: ${line}`);
          if (violation.impact === 'serious' || violation.impact === 'critical') {
            serious.push(line);
          }
        }
        if (results.violations.length === 0) {
          console.log(`[qa-a11y] ${group.who}: ${item.name}: no violations`);
        }
      }
      expect(serious).toEqual([]);
    });
  });
}
