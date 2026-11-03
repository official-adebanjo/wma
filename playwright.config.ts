import { defineConfig, devices } from '@playwright/test';
import { env } from './shared/config/env';

/**
 * One Playwright config, three projects:
 *  - unit:   calculation oracle self-tests (no network; runs anywhere, every commit)
 *  - api:    shift-left contract tests against the backend (QA Strategy §13 stage 2, §16)
 *  - admin:  Admin Portal E2E (Chromium on CI; Firefox/WebKit for cross-browser sweeps)
 */
export default defineConfig({
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  outputDir: 'reports/playwright-artifacts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['junit', { outputFile: 'reports/playwright-junit/results.xml' }], // → TestRail ingestion
  ],
  use: {
    baseURL: env.adminBaseUrl || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'unit', testDir: './unit' },
    { name: 'api', testDir: './api-tests' },
    // Live dev backend, generated from its OpenAPI document (api-dev/openapi.snapshot.json). Read-only.
    { name: 'api-dev-setup', testDir: './api-dev', testMatch: /api\.setup\.ts/ },
    { name: 'api-dev', testDir: './api-dev', testMatch: /endpoints\.spec\.ts/, dependencies: ['api-dev-setup'], retries: 0 },
    { name: 'admin-setup', testDir: './admin/fixtures', testMatch: /auth\.setup\.ts/ },
    {
      name: 'admin-chromium',
      testDir: './admin/specs',
      dependencies: ['admin-setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // Real dev Admin Portal — specs built from Playwright codegen recordings (admin/dev-portal).
    {
      name: 'admin-dev-setup',
      testDir: './admin/dev-portal',
      testMatch: /dev\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.DEV_ADMIN_URL },
    },
    {
      name: 'admin-dev',
      testDir: './admin/dev-portal',
      testMatch: /\.spec\.ts/,
      dependencies: ['admin-dev-setup'],
      timeout: 180_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.DEV_ADMIN_URL,
        storageState: '.auth/dev-super-admin.json',
        viewport: { width: 1440, height: 900 },
        trace: 'on',
        screenshot: 'on',
      },
    },
    {
      name: 'admin-firefox',
      testDir: './admin/specs',
      dependencies: ['admin-setup'],
      grep: /@smoke/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
