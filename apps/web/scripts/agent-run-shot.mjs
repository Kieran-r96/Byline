// Screenshot of the evidence workspace with the recorded Foundry agent chain expanded (P4 demonstration).
//   node scripts/agent-run-shot.mjs [--url http://localhost:4173]   (cache-only backend at 127.0.0.1:8000)
import { chromium } from '@playwright/test'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 1 })
await page.goto(url)
await page.locator('.mt[data-loading="false"]').waitFor()
await page.getByRole('radio', { name: 'Commentator', exact: true }).first().click()
await page.getByRole('button', { name: /Jump to the first AI-verified story/ }).click()
const card = page.locator('.story').filter({ has: page.locator('.stage-pill', { hasText: 'Verified' }) }).first()
await card.waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Pause replay' }).click()
await card.getByRole('button', { name: 'Show why' }).click()
await page.getByRole('button', { name: /Show how the AI reached this/ }).click()
// Clone the run outside the scrolling panel so the whole chain and all audience outputs fit in one image.
await page.evaluate(() => {
  const run = document.querySelector('.run')
  const host = document.createElement('div')
  host.id = 'shot'
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:720px;padding:24px;background:#0b1620;z-index:9999'
  host.appendChild(run.cloneNode(true))
  document.body.appendChild(host)
})
await page.locator('#shot').screenshot({ path: '../../docs/screenshots/p4-agent-run.png' })
await browser.close()
console.log('wrote docs/screenshots/p4-agent-run.png')
