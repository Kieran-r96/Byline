/**
 * Fan: the key experience takes seconds. Crests pick your side and flip the view; Discover leads with one moment;
 * Analyst puts the measurements first; Classic stays minimal.
 * REQUIRES the cache-only backend at http://127.0.0.1:8000 (see smoke.spec.ts header).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadApp, scrubTo } from './helpers'

async function asFan(page: Page, mode: 'Discover' | 'Classic' | 'Analyst', saved: object | null) {
  await loadApp(page)
  await page.evaluate((s) => (s ? localStorage.setItem('byline.fan.v4', JSON.stringify(s)) : localStorage.removeItem('byline.fan.v4')), saved)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('radio', { name: 'Fan', exact: true }).click()
  await page.getByRole('radio', { name: mode, exact: true }).click()
}

test('the primary fan interaction: pick a crest and a player, then What would you do? on the real frozen frame', async ({ page }) => {
  await asFan(page, 'Discover', null)
  await expect(page.locator('.fan__pitch')).toHaveCount(0) // no persistent pitch simulator
  await expect(page.locator('.fan__mode-line')).toHaveText('The big moments, explained as they happen.')
  await page.getByRole('radiogroup', { name: 'Your team' }).getByRole('radio', { name: /Northbridge/ }).click()
  await page.locator('.follow__pick').filter({ hasText: 'Lindqvist' }).click()
  await expect(page.locator('.you__name')).toHaveText('Lindqvist')
  await scrubTo(page, 400)
  // the 7' play-along frame is the focal moment
  const game = page.locator('.focal .m-play[data-kind="game"]')
  await expect(game).toContainText('What would you do?')
  const choices = game.locator('.wyd__choice')
  await expect(choices).toHaveCount(3)
  await choices.filter({ hasText: 'Haddad-Rhys' }).click()
  const reveal = game.locator('.wyd__reveal')
  await expect(reveal).toContainText('The pass went to Vantreight')
  await expect(reveal).toContainText('Nobody can know what would have happened next')
  await expect(reveal.locator('.vread')).toContainText('verified by Foundry agents')
  await expect(reveal).not.toContainText(/would have scored|chance of scoring|\d+%/)
  // Show me why opens the guided explanation, and Back to match returns to the feed
  await reveal.getByRole('button', { name: 'Show me why' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tactical analysis' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Back to match/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(game.locator('.wyd__reveal')).toBeVisible()
})

test('crests work from the keyboard, flip the view to the other side, and keep your player per side', async ({ page }) => {
  await asFan(page, 'Discover', null)
  const picker = page.getByRole('radiogroup', { name: 'Your team' })
  await expect(picker.getByRole('radio')).toHaveCount(2)
  await expect(picker.getByRole('radio', { checked: true })).toHaveCount(0)
  await picker.getByRole('radio', { name: /Northbridge/ }).focus()
  await page.keyboard.press('Enter')
  // the same crests become the compact switch; focus stays on your choice
  const sideSwitch = page.getByRole('radiogroup', { name: 'Your side' })
  await expect(sideSwitch.getByRole('radio', { name: 'Northbridge' })).toHaveAttribute('aria-checked', 'true')
  await expect(sideSwitch.getByRole('radio', { name: 'Northbridge' })).toBeFocused()
  await page.locator('.follow__pick').filter({ hasText: 'Lindqvist' }).click()
  await scrubTo(page, 2600)
  // arrow key flips to Riverton: their play-along frame leads, and your Northbridge player waits for you
  await sideSwitch.getByRole('radio', { name: 'Northbridge' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(sideSwitch.getByRole('radio', { name: 'Riverton' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.sb__side[data-mine="true"]')).toContainText('Riverton')
  await expect(page.locator('.focal .wyd__q')).toContainText('Tremaine')
  await expect(page.locator('.you__name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pick a player to follow' })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.you__name')).toHaveText('Lindqvist')
  // the comparison is on demand, your side first, and only measured numbers
  await page.getByRole('button', { name: 'Compare the teams' }).click()
  const cmp = page.getByRole('dialog', { name: 'Compare the teams' })
  await expect(cmp.locator('.tcmp__team').first()).toContainText('Northbridge (your side)')
  await expect(cmp).toContainText('Time on the ball')
  await expect(cmp).toContainText('Passes completed')
  await expect(cmp).toContainText('Won the ball back')
  await expect(cmp.locator('.tcmp__pattern').first()).toContainText(/Fast breaks|Channel pattern|Overlapping runs/)
})

test('before the first moment: the matchup, your player and what to look for, never an empty feed', async ({ page }) => {
  await asFan(page, 'Discover', { team: 'NBA', player: 'NBA-09', answers: {} })
  await scrubTo(page, 30)
  const matchup = page.locator('.matchup')
  await expect(matchup).toContainText('4-2-3-1')
  await expect(matchup).toContainText('Last 22 derbies')
  await expect(matchup).toContainText('Your player: Vantreight, No. 9, striker.')
  await expect(matchup).toContainText('Look out for')
  await expect(page.getByText(/Nothing here yet|The good bits land here/)).toHaveCount(0)
})

test('goals lead, routine events fold, Did you know? is rationed, your player has a filter, stats wait to be asked', async ({ page }) => {
  await asFan(page, 'Discover', { team: 'NBA', player: 'NBA-09', answers: {} })
  await scrubTo(page, 1800)
  await expect(page.locator('.focal .m-goal')).toContainText('Goal')
  await expect.poll(() => page.locator('.m-dyk').count()).toBeGreaterThan(0)
  expect(await page.locator('.m-dyk').count()).toBeLessThanOrEqual(3)
  await expect(page.locator('.tcmp')).toHaveCount(0)
  await page.getByRole('button', { name: 'Compare the teams' }).click()
  await expect(page.getByRole('dialog', { name: 'Compare the teams' })).toContainText('Shots')
  await page.getByRole('button', { name: 'Close Compare the teams' }).click()
  await page.locator('.fan__filter').filter({ hasText: 'Vantreight' }).click()
  await expect(page.locator('.fan__feed > *').first()).toContainText(/Vantreight/)
  await page.locator('.fan__filter').filter({ hasText: 'For you' }).click()
  // the 70' and 78' changes fold into one line each run, opened on demand
  await scrubTo(page, 4800)
  const run = page.locator('.m-run').first()
  await expect(run).toContainText(/changes/)
  await run.locator('summary').click()
  await expect(run.locator('.m-line').first()).toBeVisible()
})

test('Analyst puts the measurements first: side by side, patterns and measured moments with their numbers', async ({ page }) => {
  await asFan(page, 'Analyst', { team: 'NBA', player: 'NBA-09', answers: {} })
  await scrubTo(page, 1800)
  await expect(page.locator('.fan__mode-line')).toHaveText('Patterns, numbers and the evidence behind them.')
  await expect(page.locator('.fan__cmp')).toContainText('Time on the ball')
  await expect(page.locator('.fan__cmp')).toContainText('Interceptions')
  await expect(page.locator('.am__item').first().locator('.am__nums li').first()).toBeVisible()
  await expect(page.locator('.focal')).toHaveCount(0)
})

test('Classic stays minimal: score, pitch and the big events only', async ({ page }) => {
  await asFan(page, 'Classic', null)
  await scrubTo(page, 1800)
  await expect(page.locator('.fan__mode-line')).toHaveText('Score, clock and the big events. Nothing else.')
  await expect(page.locator('.fan__pitch .mt')).toBeVisible()
  await expect(page.locator('.classic-events')).toContainText('GOAL')
  await expect(page.locator('.m-play, .m-goal, .m-dyk, .notify, .side, .wyd, .tcmp')).toHaveCount(0)
})
