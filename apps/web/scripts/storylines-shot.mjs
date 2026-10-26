// Story Radar with persistent storylines, before and after the first story publishes (V4 demonstration).
//   node scripts/storylines-shot.mjs [--url http://localhost:4173]   (cache-only backend at 127.0.0.1:8000)
import { chromium } from '@playwright/test'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(url)
await page.locator('.mt[data-loading="false"]').waitFor()
await page.getByRole('radio', { name: 'Commentator', exact: true }).first().click()
await page.getByRole('button', { name: /Jump to the first AI-verified story/ }).click()
const line = page.locator('.storyline').filter({ hasText: /right channel/i })
await line.and(page.locator('[data-state="DEVELOPING"]')).waitFor({ timeout: 20_000 })
await page.locator('.panel').screenshot({ path: '../../docs/screenshots/v4-storyline-developing.png' })
await line.and(page.locator('[data-state="STRONG"]')).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Pause replay' }).click()
await line.getByRole('button', { name: /History/ }).click()
await page.locator('.panel').screenshot({ path: '../../docs/screenshots/v4-storyline-strong.png' })
await browser.close()
console.log('wrote docs/screenshots/v4-storyline-{developing,strong}.png')
