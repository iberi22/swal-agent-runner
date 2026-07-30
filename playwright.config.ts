import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './test',
  /* Only run files matching these patterns */
  testMatch: [
    '**/test/a11y/**/*.test.ts',
    '**/test/visual/**/*.test.ts',
    '**/test/e2e/**/*.test.ts',
  ],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  /* Use system Chromium for NixOS compatibility */
  use: {
    channel: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: '/run/current-system/sw/bin/chromium',
      env: {
        ...process.env,
        LD_LIBRARY_PATH: '/nix/store/gi1s8jh6314j808r8qjk9gn0rh52p5sn-nspr-4.38.2/lib:/nix/store/s6127pa293a0n56zf72241ig8cinghys-antigravity-1.23.2-fhsenv-rootfs/usr/lib64',
      },
    },
    baseURL: 'http://localhost:4173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'pnpm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
