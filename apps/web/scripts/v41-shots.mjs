// V4.1 review shots of the corrected experiences (real app, cache-only backend).
//   node scripts/v41-shots.mjs <out-dir> [--url http://localhost:4173] [--only name-substring]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/v4.1/wip'
const url = arg('--url', 'http://localhost:4173')
const only = arg('--only', '')
mkdirSync(out, { recursive: true })

const SIZES = { desk: [1440, 900], wide: [1920, 1080], laptop: [1280, 800], tablet: [1024, 768], phone: [390, 844] }
const scrub = async (p, s) => {
  await p.getByRole('slider', { name: 'Replay position' }).fill(String(s))
  await p.waitForTimeout(2600)
}
const role = async (p, name) => {
  await p.getByRole('radio', { name, exact: true }).first().click()
  await p.waitForTimeout(400)
}
const fanState = async (p, state) => {
  await p.evaluate((s) => (s ? localStorage.setItem('byline.fan.v4', JSON.stringify(s)) : localStorage.removeItem('byline.fan.v4')), state)
  await p.reload()
  await p.locator('.topbar').waitFor()
  await p.waitForTimeout(1200)
}

const SCENES = [
  { name: 'cm-prematch', sizes: ['desk', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 0) } },
  { name: 'cm-7m', sizes: ['desk', 'laptop'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 390) } },
  { name: 'cm-30m', sizes: ['desk', 'wide', 'laptop', 'tablet', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800) } },
  { name: 'cm-player', sizes: ['desk', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800); await p.locator('.sp__player').filter({ hasText: 'Vantreight' }).first().click(); await p.waitForTimeout(1500) } },
  { name: 'cm-history', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 1800); await p.getByRole('button', { name: 'Match so far' }).click(); await p.waitForTimeout(900) } },
  { name: 'cm-away', sizes: ['desk'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 4500); await p.getByRole('radio', { name: /Riverton/ }).first().click(); await p.waitForTimeout(600) } },
  { name: 'cm-analysis', sizes: ['desk', 'phone'], run: async (p) => { await role(p, 'Commentator'); await scrub(p, 390); await p.locator('.moment').getByRole('button', { name: 'Show the play' }).click(); await p.waitForTimeout(2500) } },
  { name: 'fan-pick', sizes: ['desk', 'phone'], run: async (p) => { await fanState(p, null); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 380) } },
  { name: 'fan-7m', sizes: ['desk', 'phone'], run: async (p) => { await fanState(p, { team: 'NBA', player: 'NBA-04', answers: {} }); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 400) } },
  { name: 'fan-30m', sizes: ['desk', 'phone'], run: async (p) => { await fanState(p, { team: 'NBA', player: 'NBA-09', answers: { 'T-option-NBA-0180': 'NBA-11' } }); await role(p, 'Fan'); await role(p, 'Discover'); await scrub(p, 1800) } },
  { name: 'studio-30m', sizes: ['desk'], run: async (p) => { await role(p, 'Studio'); await scrub(p, 1700) } },
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
