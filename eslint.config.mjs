// ESLint configuration for the whole monorepo (flat config).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The Content Security Policy allows no inline styles (Task D13): use classes, or
      // useCssProperties / <BrandScope> / <WidthBar> for values only known at run time.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'No style="" attributes: the Content Security Policy blocks them. Use classes or useCssProperties (lib/css-properties.ts).',
        },
        {
          selector: "JSXOpeningElement[name.name='style']",
          message: 'No <style> blocks in pages: the Content Security Policy blocks them.',
        },
      ],
    },
  },
  {
    // k6 load-test scripts (task T3) run inside k6, which provides these globals.
    files: ['scripts/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
  {
    // Load-test helpers and performance scripts print their results.
    files: ['scripts/load/**', 'apps/web/perf/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Command-line scripts may print to the console.
    files: ['**/*-cli.ts', 'apps/api/src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
