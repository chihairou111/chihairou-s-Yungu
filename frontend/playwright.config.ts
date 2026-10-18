import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    launchOptions: {
      executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: true,
    timeout: 180000,
  },
});
