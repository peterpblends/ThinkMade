import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:4173';
const API_PORT = 8799;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npx tsx ../api/src/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        PGLITE_DIR: ':memory:',
        AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
        APP_URL: WEB,
        API_URL: WEB,
        AUTH_RATE_LIMIT: '1000',
        // Test providers: scripted language model, tone voice, local storage, in-process worker.
        EMBEDDED_WORKER: 'true',
        STORAGE_DIR: '../../.data/e2e-storage',
        WORK_DIR: '../../.data/e2e-work',
      },
    },
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
