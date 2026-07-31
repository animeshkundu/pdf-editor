import { defineConfig, devices } from '@playwright/test';

// E2E drives the PRODUCTION build, not the dev server. The engine's WASM loading,
// worker instantiation and chunk splitting all behave differently under Vite's dev
// transform than in a real build, and those are precisely the paths most likely to
// break. Testing the artifact we actually ship is the only meaningful signal.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4180/',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview:site -- --port 4180',
    url: 'http://127.0.0.1:4180/pdf/app/',
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
