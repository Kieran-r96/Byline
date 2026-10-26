import { defineConfig, devices } from '@playwright/test'

/**
 * E2E against the real stack. Playwright builds the web app and starts
 * `vite preview` (port 4174) itself; the FastAPI backend must already be
 * running at http://127.0.0.1:8000 (vite proxies /api and /healthz to it):
 *
 *   cd apps/api && BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true \
 *     .venv/Scripts/python -m uvicorn byline.api.app:app --port 8000
 *
 * Then: `npm run e2e` (in apps/web). BYLINE_API_PORT and E2E_PORT override 8000 and 4174.
 */
const PORT = Number(process.env.E2E_PORT ?? 4174)

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // E2E_BASE_URL runs the suite against a deployed site (no local server is started)
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
      },
})
