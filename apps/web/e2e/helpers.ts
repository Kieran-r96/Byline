import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Wait for match detail and a live session (the transport becomes usable). */
export async function loadApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled({ timeout: 20_000 })
  await expect(page.locator('.sp__player').first()).toBeVisible({ timeout: 20_000 })
}

/** The replay position in seconds, read from the scrub control. */
export async function position(page: Page): Promise<number> {
  return Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())
}

/** Commentator: open "Match so far" on one of its tabs. */
export async function openHistory(page: Page, tab: 'Key events' | 'Developing' | 'Talking points' | 'Match log'): Promise<void> {
  await page.getByRole('button', { name: 'Match so far' }).click()
  await page.getByRole('tab', { name: tab }).click()
}

/** Seek through the real scrub control (seconds of replay time). */
export async function scrubTo(page: Page, seconds: number): Promise<void> {
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(700)
}

/** Describe the focused element (for assertions and readable failures). */
export async function focused(page: Page): Promise<{ label: string; text: string; role: string; evidenceFor: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      label: el?.getAttribute('aria-label') ?? '',
      text: (el?.textContent ?? '').trim().replace(/\s+/g, ' '),
      role: el?.getAttribute('role') ?? el?.tagName.toLowerCase() ?? '',
      evidenceFor: el?.getAttribute('data-evidence-for') ?? '',
    }
  })
}

/** Press Tab until `match` accepts the focused element (bounded). */
export async function tabTo(
  page: Page,
  match: (f: Awaited<ReturnType<typeof focused>>) => boolean,
  max = 120,
): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab')
    if (match(await focused(page))) return
  }
  throw new Error(`Focus target not reached after ${max} Tab presses (last: ${JSON.stringify(await focused(page))})`)
}

/** The focused element shows a visible focus indicator (ring or outline). */
export async function expectVisibleFocus(page: Page): Promise<void> {
  const visible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return false
    const cs = getComputedStyle(el)
    // A real focus ring: a >= 2px outline, or an explicit gold ring shadow.
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2
    const ring = /0px 0px 0px [2-4]px/.test(cs.boxShadow)
    return outline || ring
  })
  expect(visible, `visible focus on ${JSON.stringify(await focused(page))}`).toBe(true)
}

/** Open a match-centre tab by its label (the Commentator lands on Live). */
export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).first().click()
}
