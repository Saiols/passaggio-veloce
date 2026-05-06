import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config minimo per smoke test E2E.
 *
 * Run locale: `pnpm --filter piattaforma exec playwright install` (una tantum)
 * poi `pnpm --filter piattaforma test:e2e`. Il config presume un dev server
 * già up su localhost:3000 (configurabile via PLAYWRIGHT_BASE_URL).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
