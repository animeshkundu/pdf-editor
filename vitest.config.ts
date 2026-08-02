import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // lib/ kernels are framework-free and DOM-free by construction, so most suites
    // run in node. Per-file overrides use `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    globals: true,
    reporters: ['default', 'json'],
    outputFile: { json: 'artifacts/test-results/vitest.json' },
  },
});
