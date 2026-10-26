/**
 * No look-ahead across roles (golden match BYLINE-01): the 28' right-channel story arrives on playback,
 * vanishes on a backward seek and returns once on replay. Classic never shows it.
 * REQUIRES the cache-only backend at http://127.0.0.1:8000 (see smoke.spec.ts header).
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { loadApp, openHistory, scrubTo } from './helpers'

const RIGHT_CHANNEL = /right channel/i

function storyFor(page: Page, role: 'Commentator' | 'Studio' | 'Fan'): Locator {
  if (role === 'Commentator') return page.locator('.dev[data-kind="ai-story"]').filter({ hasText: RIGHT_CHANNEL })
  if (role === 'Studio') return page.locator('.q__item').filter({ hasText: RIGHT_CHANNEL })
  return page.locator('.m-play--story').filter({ hasText: RIGHT_CHANNEL })
}

async function playThrough(page: Page, fromS: number, untilVisible: () => Promise<void>) {
  await scrubTo(page, fromS)
  await page.getByRole('radio', { name: '30 times speed' }).click()
  const play = page.getByRole('button', { name: 'Play replay' })
  if (await play.isVisible()) await play.click()
  await untilVisible()
  const pause = page.getByRole('button', { name: 'Pause replay' })
  if (await pause.isVisible()) await pause.click()
}

for (const role of ['Commentator', 'Studio', 'Fan'] as const) {
  test(`${role}: story arrives on playback, vanishes on backward seek, returns once on replay`, async ({ page }) => {
    await loadApp(page)
    await page.getByRole('radio', { name: role, exact: true }).click()
    if (role === 'Fan') await page.getByRole('radio', { name: 'Discover', exact: true }).click()
    // the Commentator keeps developing stories one tap away, in "Match so far"
    if (role === 'Commentator') await openHistory(page, 'Developing')
    await scrubTo(page, 1500)
    await expect(storyFor(page, role)).toHaveCount(0)
    await playThrough(page, 1560, async () => {
      await expect(storyFor(page, role).first()).toBeVisible({ timeout: 30_000 })
    })
    await scrubTo(page, 900)
    await expect(storyFor(page, role)).toHaveCount(0)
    await page.getByRole('button', { name: 'Restart replay' }).click()
    await expect(storyFor(page, role)).toHaveCount(0)
    await scrubTo(page, 1700)
    await expect(storyFor(page, role).first()).toBeVisible({ timeout: 15_000 })
    if (role === 'Commentator') await expect(storyFor(page, role)).toHaveCount(1)
  })
}

test('Key moments menu lists AI-verified stories and decisions, and jumps the replay', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('button', { name: 'Key moments' }).click()
  const dialog = page.getByRole('dialog', { name: 'Key moments' })
  const items = dialog.getByRole('button')
  await expect.poll(() => items.count()).toBeGreaterThanOrEqual(8)
  await expect(dialog.getByText('AI verified')).toHaveCount(4)
  await items.filter({ hasText: 'Overlap run' }).click()
  await openHistory(page, 'Developing')
  await expect(page.locator('.dev[data-kind="ai-story"]').filter({ hasText: /overlap/i }).first()).toBeVisible({ timeout: 25_000 })
})

test('Show the evidence → Replay evidence rewinds to the build-up, keeps the verified story open, and stops at the end', async ({ page }) => {
  await loadApp(page)
  await scrubTo(page, 1660)
  await openHistory(page, 'Developing')
  await page.locator('.dev[data-kind="ai-story"]').filter({ hasText: RIGHT_CHANNEL }).first().getByRole('button', { name: 'See the evidence' }).click()
  await expect(page.getByText(/Verified story · Foundry agents/)).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.evidence__replay-meta')).toContainText('30×')
  await page.getByRole('button', { name: 'Replay evidence' }).click()
  await expect(page.getByRole('button', { name: 'Stop replay' })).toBeVisible()
  const slider = page.getByRole('slider', { name: 'Replay position' })
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(1600)
  await expect(page.locator('.evidence .stage-pill')).toHaveText(/Verified/)
  await expect(page.getByRole('button', { name: 'Replay evidence' })).toBeVisible({ timeout: 40_000 })
  expect(Number(await slider.inputValue())).toBeGreaterThan(1630)
})
