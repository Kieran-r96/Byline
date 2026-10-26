/**
 * AI insight language: Español shows the agents' recorded Spanish translation of verified insights and stories,
 * labelled as a translation; English comes back unchanged. The rest of the interface stays in English.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadApp, scrubTo } from './helpers'

async function setLanguage(page: Page, label: 'English' | 'Español') {
  await page.getByRole('button', { name: 'Settings and system status' }).click()
  await page.getByRole('radio', { name: new RegExp(`^${label}`) }).check()
  await page.getByRole('button', { name: 'Settings and system status' }).click()
}

test('Español shows the recorded Spanish verified insight and story, and English restores them', async ({ page }) => {
  await loadApp(page)
  await scrubTo(page, 390)
  const line = page.locator('.moment .verified-line')
  await expect(line).toContainText("Lindqvist's pass was cut out")
  await setLanguage(page, 'Español')
  await expect(line).toContainText('El pase de Lindqvist fue cortado')
  await expect(line).toContainText('Spanish translation')
  // the verified story at 28' in its recorded Spanish title
  await scrubTo(page, 1800)
  await expect(page.locator('.dev[data-kind="ai-story"]').first()).toContainText('centra sus ataques')
  // persists across a refresh
  await page.reload()
  await expect(page.locator('.sp__player').first()).toBeVisible({ timeout: 20_000 })
  await scrubTo(page, 390)
  await expect(page.locator('.moment .verified-line')).toContainText('El pase de Lindqvist')
  await setLanguage(page, 'English')
  await expect(page.locator('.moment .verified-line')).not.toContainText('Spanish translation')
  await expect(page.locator('.moment .verified-line')).toContainText("Lindqvist's pass was cut out")
})
