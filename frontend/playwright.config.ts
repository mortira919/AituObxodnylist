import { defineConfig, devices } from '@playwright/test'

// Сквозные сценарии в настоящем браузере. Сервер в них фейковый (e2e/fakeApi.ts):
// он соблюдает контракт docs/backend/openapi.yaml и правила из ТЗ (кроме отзыва сессий из R19).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 4,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
})
