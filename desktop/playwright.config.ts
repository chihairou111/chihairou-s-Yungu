import { defineConfig } from '@playwright/test';

// Runs the built shell (`npm run build` first) on the frontend's standalone build with the mock data
// source. On Linux without a display: `xvfb-run -a npx playwright test`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
});
