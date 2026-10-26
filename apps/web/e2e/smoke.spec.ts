/**
 * BYLINE end-to-end smoke (golden match BYLINE-01).
 *
 * REQUIRES the FastAPI backend at http://127.0.0.1:8000 before running
 * (Playwright starts `vite preview` itself, which proxies /api to it):
 *
 *   cd apps/api && BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true \
 *     .venv/Scripts/python -m uvicorn byline.api.app:app --port 8000
 *   cd apps/web && npm run e2e
 *
 * Works with any AI mode (cache-only, off, foundry): it asserts structure
 * and real stage labels, never specific model wording.
 */
import { expect, test } from '@playwright/test'
import { loadApp, openHistory, scrubTo } from './helpers'

test('play, story arrives with its real stage, evidence lists source events, VAR check shows and withdraws the story', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('button', { name: 'Play replay' }).click()
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible()

  // 1,700,000 ms: the 28' right-channel story (detected at 1,633,200 ms) is deep analysis in Developing
  await scrubTo(page, 1700)
  await openHistory(page, 'Developing')
  const story = page.locator('.dev[data-kind="ai-story"]').filter({ hasText: /right channel/i }).first()
  await expect(story).toBeVisible()
  await expect(story).toContainText('verified by Foundry agents')
  await story.getByRole('button', { name: 'See the evidence' }).click()
  await expect.poll(() => page.locator('.evidence__events li').count()).toBeGreaterThanOrEqual(5)
  await expect(page.locator('.mt__legend')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.evidence')).toHaveCount(0)

  // play through the 71' VAR check to the 72' disallowed goal
  await scrubTo(page, 4330)
  await page.getByRole('radio', { name: '30 times speed' }).click()
  const play = page.getByRole('button', { name: 'Play replay' })
  if (await play.isVisible()) await play.click()
  await expect(page.locator('.scorebug__period--checking')).toHaveText('VAR CHECK', { timeout: 30_000 })
  await expect(page.locator('.dev[data-kind="ai-story"][data-status="withdrawn"]').first()).toBeVisible({ timeout: 30_000 })
})
