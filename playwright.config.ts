import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 4173);
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: ci,
  // No retries. A test that needs a second attempt is a bug report.
  retries: 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: 'api/**/*.spec.ts' },
    { name: 'e2e', testMatch: 'e2e/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node --no-warnings server/main.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(port), TEST_HOOKS: '1', FAULTS: process.env.FAULTS ?? '' },
  },
});
