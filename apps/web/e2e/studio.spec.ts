/**
 * V4 Studio: live production and the analysis desk (demo output only).
 * REQUIRES the cache-only backend at http://127.0.0.1:8000 (see smoke.spec.ts header).
 */
import { expect, test } from '@playwright/test'
import { loadApp, scrubTo } from './helpers'

test('live production: a goal graphic is previewed, approved by a human and airs on the demo programme monitor', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await expect(page.getByText('Demo output: simulated programme feed. No broadcast hardware or playout is connected.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Signal path in this demo' })).toContainText('Not connected')
  await scrubTo(page, 1700)
  const goal = page.locator('.q__item').filter({ hasText: /GOAL/ }).first()
  await goal.click()
  await expect(page.locator('.monitor[data-kind="pvw"] .gx-flash')).toBeVisible()
  await expect(page.locator('.monitor[data-kind="pgm"] .gx')).toHaveCount(0) // nothing airs without approval
  await page.getByRole('button', { name: 'Take to air now' }).click()
  await expect(page.locator('.monitor[data-kind="pgm"] .gx-flash')).toBeVisible()
  await expect(page.locator('.monitor[data-kind="pgm"] .gframe__label')).toHaveText('PROGRAMME · ON AIR')
  await expect(page.locator('.monitor[data-kind="pgm"] .gframe__mark')).toHaveText('Simulated output')
  await page.getByRole('button', { name: 'Take off air' }).click()
  await expect(page.locator('.monitor[data-kind="pgm"] .gx')).toHaveCount(0)
})

test('live production: a graphic can be scheduled for the next stoppage', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 500)
  // the broadcast title of the 7' moment is short: "Better option on · 7'"
  const tactic = page.locator('.q__item').filter({ hasText: /Better option on/ }).first()
  await tactic.click()
  await expect(page.locator('.monitor[data-kind="pvw"] .gslot[data-family="breakthrough"]')).toBeVisible()
  await page.getByRole('button', { name: 'At the next stoppage' }).click()
  await expect(page.locator('.q__lane[data-lane="next"] .q__item')).toContainText('Airs at the next stoppage')
})

test('formats: one graphic previews as a lower third, corner box, player spotlight or full-screen analysis, and airs in the format picked', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 1700)
  await page.locator('.q__item').filter({ hasText: /GOAL/ }).first().click()
  const pvw = page.locator('.monitor[data-kind="pvw"] .gframe')
  await expect(pvw).toHaveAttribute('data-format', 'lower')
  for (const [name, fmt] of [
    ['Corner box', 'pip'],
    ['Player spotlight', 'spotlight'],
    ['Full-screen analysis', 'full'],
  ] as const) {
    await page.getByRole('radio', { name }).check()
    await expect(pvw).toHaveAttribute('data-format', fmt)
  }
  await expect(pvw.locator('.fx-full')).toContainText('Vantreight')
  await expect(page.locator('.monitor[data-kind="pgm"] .gx')).toHaveCount(0) // previewing never airs
  await page.getByRole('button', { name: 'Take to air now' }).click()
  const pgm = page.locator('.monitor[data-kind="pgm"] .gframe')
  await expect(pgm).toHaveAttribute('data-format', 'full')
  await expect(pgm.locator('.fx-full')).toContainText('Vantreight')
  await expect(page.getByRole('radio', { name: 'Corner box' })).toBeDisabled() // locked while on air
  await page.getByRole('button', { name: 'Take off air' }).click()
  await expect(page.locator('.monitor[data-kind="pgm"] .gx')).toHaveCount(0)
})

test('the tactical breakdown airs as an upper-right corner box over the live picture', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 500)
  await page.locator('.q__item').filter({ hasText: /Better option on/ }).first().click()
  await expect(page.locator('.monitor[data-kind="pvw"] .gframe')).toHaveAttribute('data-format', 'pip')
  await page.getByRole('button', { name: 'Take to air now' }).click()
  await expect(page.locator('.monitor[data-kind="pgm"] .fx-pip__box .clip')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.monitor[data-kind="pgm"] .transport')).toContainText('corner box')
})

test('VAR holds a goal graphic: it cannot be approved while the check is on', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 4400) // inside the 72'-73' VAR check of the provisional goal
  const held = page.locator('.q__lane[data-lane="held"] .q__item').first()
  await expect(held).toBeVisible({ timeout: 15_000 })
  await held.click()
  await expect(page.getByRole('button', { name: 'Held by VAR' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'At the next stoppage' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'In 30 seconds' })).toBeDisabled()
  await expect(page.locator('.studio__guards li[data-active="true"]')).toContainText('VAR hold')
})

test('a goal graphic withdrawn after the VAR decision can never be taken to air', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 4500) // after the goal is disallowed
  const withdrawn = page.locator('.q__lane[data-lane="withdrawn"] .q__item').filter({ hasText: /GOAL/ }).first()
  await expect(withdrawn).toBeVisible({ timeout: 15_000 })
  await expect(withdrawn).toContainText('Cannot air: its source was withdrawn')
  await withdrawn.click()
  await expect(page.locator('.monitor[data-kind="pvw"] .slate[data-kind="withdrawn"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take to air now' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'At the next stoppage' })).toHaveCount(0)
  await expect(page.locator('.monitor[data-kind="pgm"] .gx-flash')).toHaveCount(0)
})

test('analysis desk: break down the 7th-minute moment, compare actual and hypothetical, and send it to production', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 2900)
  await page.getByRole('tab', { name: 'Analysis desk' }).click()
  await page.getByRole('tab', { name: 'Half-time' }).click()
  await page.locator('.adesk__item').filter({ hasText: /Haddad-Rhys was open/ }).click()
  await expect(page.locator('.adesk__title')).toContainText('Haddad-Rhys was open')
  const table = page.locator('.cmp__table')
  await expect(table.locator('tr[data-kind="actual"]')).toContainText(/played · intercepted/)
  await expect(table.locator('tr[data-kind="hypo"]').first()).toContainText(/hypothetical/)
  await page.getByRole('button', { name: 'Add to package' }).click()
  await page.getByRole('button', { name: 'Send to production' }).first().click()
  await expect(page.locator('.adesk__msg')).toHaveText(/production queue/)
  await page.getByRole('tab', { name: /Live production/ }).click()
  await expect(page.locator('.q__item').filter({ hasText: /Better option on/ }).first()).toBeVisible()
})

test('package builder: order the half-time package by keyboard, preview an item, send the package in running order', async ({ page }) => {
  await loadApp(page)
  await page.getByRole('radio', { name: 'Studio', exact: true }).click()
  await scrubTo(page, 2900)
  await page.getByRole('tab', { name: 'Analysis desk' }).click()
  await page.getByRole('tab', { name: 'Half-time' }).click()
  await page.locator('.adesk__item').filter({ hasText: /Haddad-Rhys was open/ }).click()
  await page.getByRole('button', { name: 'Add to package' }).click()
  await page.getByRole('button', { name: 'Add a stats panel' }).click()
  const order = page.getByRole('list', { name: 'Half-time running order' })
  await expect(order.locator('.rundown__title')).toHaveText([/Haddad-Rhys/, 'Half-time stats panel'])
  // move the stats panel to the top with the keyboard
  await page.getByRole('button', { name: 'Move Half-time stats panel up' }).focus()
  await page.keyboard.press('Enter')
  await expect(order.locator('.rundown__title')).toHaveText(['Half-time stats panel', /Haddad-Rhys/])
  await expect(page.getByRole('button', { name: 'Move Half-time stats panel up' })).toBeFocused()
  // preview each item in its format before sending
  await page.getByRole('button', { name: 'Preview Half-time stats panel' }).click()
  await expect(page.locator('.pkg__monitor .gframe')).toHaveAttribute('data-format', 'full')
  await page.getByRole('radio', { name: 'Corner box' }).click()
  await expect(page.locator('.pkg__monitor .gframe')).toHaveAttribute('data-format', 'pip')
  await page.getByRole('button', { name: /Send package to production/ }).click()
  await expect(page.locator('.adesk__msg')).toContainText('Sent 2 of 2')
  await page.getByRole('button', { name: 'Open in production' }).first().click()
  // the producer still approves: the package arrives for review, in its running order, in the format picked
  await expect(page.locator('.q__item').filter({ hasText: 'Half-time package 1 of 2' })).toBeVisible()
  await expect(page.locator('.q__item').filter({ hasText: 'Half-time package 2 of 2' })).toBeVisible()
  await expect(page.locator('.monitor[data-kind="pvw"] .gframe')).toHaveAttribute('data-format', 'pip')
  await expect(page.getByRole('button', { name: 'Take to air now' })).toBeEnabled()
})
