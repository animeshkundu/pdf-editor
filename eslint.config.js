import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.vercel/**',
      'site/app/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'vendor/**',
      'crates/**/target/**',
      'crates/**/pkg/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // MuPDF's WASM objects are manually memory-managed: all 27 Userdata classes require
  // an explicit .destroy(), and there is no FinalizationRegistry to catch mistakes. A
  // leaked Pixmap leaks until the page reloads, and this is the single most common
  // production failure in mupdf.js. Construction is therefore confined to the engine
  // worker, where every handle is acquired through an Arena that releases in reverse
  // order on job exit. See docs/adr/0009-wasm-memory-and-handle-discipline.md.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['lib/engine/worker/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mupdf',
              message:
                'Import MuPDF only inside lib/engine/worker/. Everywhere else, go through the PdfEngine port in lib/engine/port.ts.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['lib/engine/worker/**/*.ts'],
    rules: {
      // Inside the worker, every MuPDF object must be registered with an Arena or the
      // RETAINED map at construction. A bare `new mupdf.X()` is unowned and will leak.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.object.name='mupdf']:not(:matches(CallExpression[callee.property.name=/^(keep|retain)$/] > NewExpression))",
          message:
            'Wrap MuPDF construction in arena.keep(...) or retain(key, ...) so it is released deterministically.',
        },
      ],
    },
  },
);
