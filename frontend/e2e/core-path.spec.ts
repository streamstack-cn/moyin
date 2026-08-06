import { test, expect } from '@playwright/test'

/**
 * 核心路径冒烟（需登录态数据）：
 *   MOYIN_E2E_BASE_URL=http://127.0.0.1:6173 \
 *   MOYIN_E2E_USER=admin MOYIN_E2E_PASS=... \
 *   npx playwright test
 * 未设置 BASE_URL 时全部 skip。
 */
const enabled = Boolean(process.env.MOYIN_E2E_BASE_URL)
const user = process.env.MOYIN_E2E_USER || 'admin'
const pass = process.env.MOYIN_E2E_PASS || ''

test.describe('MoYin core path', () => {
  test.skip(!enabled, 'Set MOYIN_E2E_BASE_URL to run')

  test('login → library → open reader shell → citation → AI reader', async ({ page }) => {
    test.skip(!pass, 'Set MOYIN_E2E_PASS for authenticated core path')

    await page.goto('/login')
    await expect(page.getByRole('button', { name: /登录|登 录/ })).toBeVisible({ timeout: 15000 })

    const userInput = page.locator('input[type="text"], input[name="username"], input[autocomplete="username"]').first()
    const passInput = page.locator('input[type="password"]').first()
    await userInput.fill(user)
    await passInput.fill(pass)
    await page.getByRole('button', { name: /登录|登 录/ }).click()

    await expect(page).not.toHaveURL(/\/login/, { timeout: 20000 })

    // 书库
    await page.goto('/library')
    await expect(page.getByRole('heading', { name: /我的书库/ })).toBeVisible({ timeout: 15000 })
    await expect(page.getByLabel('快捷找书')).toBeVisible()

    // 尝试打开第一本可读的书（若书库为空则跳过阅读器段）
    const firstCover = page.locator('a[href*="/read/"], .book-card a, .book-card').first()
    if (await firstCover.count()) {
      await firstCover.click({ timeout: 5000 }).catch(() => {})
      // 阅读器壳：退出/返回或阅读区
      const readerShell = page.locator('.reader-shell, .reader-root, .pdf-reader, [class*="reader"]').first()
      if (await readerShell.count()) {
        await expect(readerShell).toBeVisible({ timeout: 20000 })
      }
      // 回到主界面
      await page.goto('/library')
    }

    await page.goto('/citation')
    await expect(page.getByText(/引用篮|引用/).first()).toBeVisible({ timeout: 15000 })

    await page.goto('/ai-reader')
    await expect(page.getByText(/伴读|AI/).first()).toBeVisible({ timeout: 15000 })
  })
})
