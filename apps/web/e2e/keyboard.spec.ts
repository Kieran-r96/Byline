/**
 * Keyboard-only walkthrough (T021, V4.1 surfaces). Seeking uses the scrub control as setup only; every
 * interaction under test is performed with the keyboard, and each target shows a visible focus indicator.
 * REQUIRES the cache-only backend at http://127.0.0.1:8000.
 */
import { expect, test } from '@playwright/test'
import { expectVisibleFocus, focused, loadApp, scrubTo, tabTo } from './helpers'

test('Tab reaches Play; Space toggles; global Space works outside controls', async ({ page }) => {
  await loadApp(page)
  await tabTo(page, (f) => f.label === 'Play replay')
  await expectVisibleFocus(page)
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible()
})

test('Show the play → Escape returns focus to the control that opened it', async ({ page }) => {
  await loadApp(page)
  await scrubTo(page, 390)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabTo(page, (f) => f.text === 'Show the play')
  await expectVisibleFocus(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Tactical analysis' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Tactical analysis' })).toHaveCount(0)
  expect((await focused(page)).text).toBe('Show the play')
  await expectVisibleFocus(page)
})

test('a shirt → the player file → Mark used → Undo, by keyboard', async ({ page }) => {
  await loadApp(page)
  await scrubTo(page, 1800)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabTo(page, (f) => f.role === 'button' && f.text.includes('Nico Vantreight, number 9'))
  await expectVisibleFocus(page)
  await page.keyboard.press('Enter')
  const file = page.getByRole('dialog', { name: 'Player file' })
  await expect(file.locator('.sf__name')).toContainText('Vantreight')
  const hero = file.locator('.hero-fact__text')
  await expect(hero).toBeVisible()
  expect((await focused(page)).label).toBe('Close and return to the match')
  const first = (await hero.innerText()).trim()
  await tabTo(page, (f) => f.text === 'Mark used' && f.role === 'button', 40)
  await expectVisibleFocus(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Marked as used' })).toBeVisible()
  await expect(hero).not.toHaveText(first)
  await tabTo(page, (f) => f.text === 'Undo' && f.role === 'button', 60)
  await page.keyboard.press('Enter')
  await expect(hero).toHaveText(first)
})

test('Studio: keyboard approval puts the graphic on the demo programme monitor', async ({ page }) => {
  await loadApp(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabTo(page, (f) => f.role === 'radio' && f.text === 'Commentator')
  await page.keyboard.press('ArrowRight')
  expect((await focused(page)).text).toBe('Studio')
  await scrubTo(page, 1700)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await tabTo(page, (f) => f.text.startsWith("28'") && f.text.includes('GOAL'))
  await page.keyboard.press('Enter')
  await tabTo(page, (f) => f.text === 'Take to air now')
  await expectVisibleFocus(page)
  await page.keyboard.press('Enter')
  await expect(page.locator('.monitor[data-kind="pgm"] .gx-flash')).toBeVisible()
})
