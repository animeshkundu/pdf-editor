import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PDF_EDITOR_E2E_PORT ?? 4180);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PDF_EDITOR_E2E_PORT must be an integer from 1 through 65535.');
}
const origin = `http://127.0.0.1:${port}`;

// E2E drives the PRODUCTION build, not the dev server. The engine's WASM loading,
// worker instantiation and chunk splitting all behave differently under Vite's dev
// transform than in a real build, and those are precisely the paths most likely to
// break. Testing the artifact we actually ship is the only meaningful signal.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  // The bundled OCR acceptance run saturates the shared CI runner; serial files keep
  // keyboard timing assertions meaningful instead of measuring cross-spec CPU contention.
  workers: process.env.CI === 'true' ? 1 : 2,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: `${origin}/`,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview:site -- --port ${port}`,
    url: `${origin}/pdf/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    // The browser floor is set by MuPDF's `-fwasm-exceptions` build, which needs
    // native WebAssembly exception handling: Chrome 95+, Firefox 131+, Safari 15.2+.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
