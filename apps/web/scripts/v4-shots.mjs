// V4 surfaces: screenshots of each role at several breakpoints (real app, cache-only backend).
//   node scripts/v4-shots.mjs <out-dir> [--url http://localhost:4173] [--only name-substring]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/v4'
const url = arg('--url', 'http://localhost:4173')
const only = arg('--only', '')
mkdirSync(out, { recursive: true })

const SIZES = { desk: [1440, 900], wide: [1920, 1080], laptop: [1280, 800], tablet: [1024, 768], phone: [390, 844] }

async function scrub(page, seconds) {
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(2600)
}

async function role(page, name) {
  await page.getByRole('radio', { name, exact: true }).first().click()
  await page.waitForTimeout(400)
}

const SCENES = [
  { name: 'commentator-30m', sizes: ['desk', 'wide', 'laptop', 'tablet', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800) } },
  { name: 'commentator-research-player', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800); await p.locator('.sheet__player').filter({ hasText: 'Vantreight' }).first().click(); await p.waitForTimeout(900) } },
  { name: 'commentator-h2h', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800); await p.getByRole('tab', { name: 'Head to head' }).click(); await p.waitForTimeout(900) } },
  { name: 'commentator-analysis-step1', sizes: ['desk', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 390); await p.locator('.lead, .disc').filter({ hasText: /was open as/i }).getByRole('button', { name: 'Show the play' }).first().click(); await p.waitForTimeout(2500) } },
  { name: 'commentator-analysis-step4', sizes: ['desk', 'wide'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 390); await p.locator('.lead, .disc').filter({ hasText: /was open as/i }).getByRole('button', { name: 'Show the play' }).first().click(); await p.waitForTimeout(1500); await p.locator('.ta__stage').getByRole('button', { name: /What if/ }).first().click(); await p.waitForTimeout(2500) } },
  { name: 'commentator-prematch', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 0) } },
  { name: 'commentator-live-alert', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1625); await p.getByRole('radio', { name: '4 times speed' }).click(); await p.getByRole('button', { name: 'Play replay' }).click(); await p.locator('.notify .alert-plate').waitFor({ timeout: 20000 }); await p.getByRole('button', { name: 'Pause replay' }).click(); await p.waitForTimeout(400) } },
  { name: 'studio-on-air', sizes: ['desk', 'wide'], run: async (p) => { await role(p, 'Studio'); await scrub(p, 1700); await p.locator('.q__item').filter({ hasText: /GOAL/ }).first().click(); await p.getByRole('button', { name: 'Take to air now' }).click(); await p.waitForTimeout(900) } },
  { name: 'studio-production-30m', sizes: ['desk', 'wide', 'tablet'], run: async (p) => { await role(p, 'Studio'); await scrub(p, 1700) } },
  { name: 'studio-analysis-ht', sizes: ['desk', 'wide'], run: async (p) => { await role(p, 'Studio'); await scrub(p, 2900); await p.getByRole('tab', { name: 'Analysis desk' }).click(); await p.waitForTimeout(1200) } },
  { name: 'fan-discover-pick', sizes: ['desk', 'phone'], run: async (p) => { await p.evaluate(() => localStorage.removeItem('byline.fan.v4')); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 600) } },
  { name: 'fan-discover-30m', sizes: ['desk', 'phone'], run: async (p) => { await p.evaluate(() => localStorage.setItem('byline.fan.v4', JSON.stringify({ team: 'NBA', player: 'NBA-09', answers: {} }))); await p.reload(); await p.locator('.topbar').waitFor(); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 1800) } },
  { name: 'fan-would-you-do', sizes: ['desk', 'phone'], run: async (p) => { await p.evaluate(() => localStorage.setItem('byline.fan.v4', JSON.stringify({ team: 'NBA', player: 'NBA-04', answers: {} }))); await p.reload(); await p.locator('.topbar').waitFor(); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 400); await p.locator('.wyd__choice').filter({ hasText: 'Haddad-Rhys' }).first().click(); await p.waitForTimeout(800); await p.locator('.wyd').first().scrollIntoViewIfNeeded(); await p.waitForTimeout(300) } },
  { name: 'fan-classic', sizes: ['desk', 'phone'], run: async (p) => { await role(p, 'Fan'); await role(p, 'Classic'); await scrub(p, 1800) } },
]

const browser = await chromium.launch()
for (const scene of SCENES) {
  if (only && !scene.name.includes(only)) continue
  for (const size of scene.sizes) {
    const [width, height] = SIZES[size]
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.log('pageerror', scene.name, e.message))
    await page.goto(url)
    await page.locator('.topbar').waitFor()
    await page.waitForTimeout(1500)
    try {
      await scene.run(page)
      await page.screenshot({ path: `${out}/${scene.name}-${size}.png` })
      console.log('wrote', scene.name, size)
    } catch (e) {
      console.log('FAILED', scene.name, size, String(e).split('\n')[0])
    }
    await page.close()
  }
}
await browser.close()
