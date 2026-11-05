import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

describe('forms (Task T1)', () => {
  it('every form posts, so typed details never end up in a web address', () => {
    // If a form is sent before the page's code runs (slow phone), the browser sends it itself:
    // without method="post" that puts every field, passwords included, into the address bar,
    // the browser history and the server logs.
    const missing: string[] = [];
    for (const file of sourceFiles(path.resolve(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      // method="post" is kept as the first attribute of every <form>.
      if (/<form\b(?!\s+method="post")/.test(text)) missing.push(path.relative(process.cwd(), file));
    }
    expect(missing).toEqual([]);
  });
});
