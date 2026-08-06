import { test, expect } from '@playwright/test'

const enabled = Boolean(process.env.MOYIN_E2E_BASE_URL)

test.describe('MoYin smoke', () => {
  test.skip(!enabled, 'Set MOYIN_E2E_BASE_URL to run browser smoke')

  test('login page renders', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /登录|登 录/ })).toBeVisible({ timeout: 15000 })
  })
})
