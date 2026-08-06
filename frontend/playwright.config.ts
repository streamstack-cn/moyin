import { defineConfig, devices } from '@playwright/test'

/**
 * 可选 E2E：设置 MOYIN_E2E_BASE_URL（例如 http://127.0.0.1:6173）后执行
 *   npx playwright test
 * 未设置时全部 skip，不影响日常 CI / 重构自检。
 */
const baseURL = process.env.MOYIN_E2E_BASE_URL || ''

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: baseURL || 'http://127.0.0.1:6173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
