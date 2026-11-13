// Names used by the live load test's fictional data (load-test-data.ts). No side effects.

export const LOAD_TEST_PREFIX = 'load-test-';
const WORDS = (
  'members committee meeting quorum treasurer secretary chairperson vote election notice ' +
  'resolution annual general special accounts audit property trustees discipline appeal ' +
  'membership subscription register minutes amendment dissolution assets church society'
).split(' ');

/** True only for the web addresses this tool creates. */
export function isLoadTestSlug(slug: string): boolean {
  return /^load-test-\d{12}$/.test(slug);
}

/** The fictional members' email addresses (example.com is reserved for examples). */
export function loadTestEmail(slug: string, n: number): string {
  return `${slug}-${n}@example.com`;
}

/** A fixed, readable sentence of fictional constitution text. */
export function fictionalSentence(seed: number): string {
  return (
    Array.from({ length: 18 }, (_, index) => WORDS[(seed * 7 + index * 13) % WORDS.length]).join(
      ' ',
    ) + '.'
  );
}
