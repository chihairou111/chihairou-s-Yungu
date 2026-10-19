import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    launchOptions: {
      executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
      // A fake camera and microphone, granted without a prompt, for the Camera and Record dialogs.
      args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    // The end-to-end run never reaches the Yungu service: the data layer is the in-memory mock.
    command: 'export DATA_SOURCE=mock && npm run build && npx next start -p 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
