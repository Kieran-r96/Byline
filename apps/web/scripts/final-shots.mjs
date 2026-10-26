// Final-pass review shots (real app, cache-only backend).
//   node scripts/final-shots.mjs <out-dir> [--url http://localhost:4173] [--only name-substring]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/final-pass/wip'
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
const commentator = async (p, s) => {
  await role(p, 'Commentator')
  await scrub(p, s)
}

const SCENES = [
  { name: 'cm-prematch', sizes: ['desk', 'phone'], run: (p) => commentator(p, 0) },
  { name: 'cm-7m', sizes: ['desk', 'laptop', 'tablet'], run: (p) => commentator(p, 390) },
  { name: 'cm-30m', sizes: ['desk', 'wide', 'laptop', 'tablet', 'phone'], run: (p) => commentator(p, 1800) },
  { name: 'cm-quiet', sizes: ['desk'], run: (p) => commentator(p, 2400) },
  {
    name: 'cm-player',
    sizes: ['desk', 'phone'],
    run: async (p) => {
      await commentator(p, 1800)
      await p.locator('.sp__player').filter({ hasText: 'Vantreight' }).first().click()
      await p.waitForTimeout(1500)
    },
  },
  {
    name: 'cm-player-today',
    sizes: ['desk'],
    run: async (p) => {
      await commentator(p, 1800)
      await p.locator('.sp__player').filter({ hasText: 'Haddad' }).first().click()
      await p.waitForTimeout(1200)
      await p.locator('.sf__panel').scrollIntoViewIfNeeded()
      await p.waitForTimeout(400)
    },
  },
  {
    name: 'cm-club',
    sizes: ['desk', 'phone'],
    run: async (p) => {
      await commentator(p, 1800)
      await p.getByRole('button', { name: 'Northbridge Athletic club file' }).click()
      await p.waitForTimeout(1500)
    },
  },
  {
    name: 'cm-club-rivalry',
    sizes: ['desk'],
    run: async (p) => {
      await commentator(p, 1800)
      await p.getByRole('button', { name: 'Riverton City club file' }).click()
      await p.waitForTimeout(1200)
      await p.getByRole('tab', { name: 'Rivalry' }).click()
      await p.waitForTimeout(1200)
      await p.locator('.sf__panel').scrollIntoViewIfNeeded()
    },
  },
  {
    name: 'cm-detail',
    sizes: ['desk'],
    run: async (p) => {
      await commentator(p, 1800)
      await p.locator('.say__item').first().getByRole('button', { name: 'Detail' }).click()
      await p.waitForTimeout(500)
    },
  },
  {
    name: 'cm-nudge',
    sizes: ['desk'],
    run: async (p) => {
      await commentator(p, 1560)
      await p.locator('.sp__player').filter({ hasText: 'Ferrandi' }).first().click()
      await p.getByRole('radio', { name: '4 times speed' }).click()
      await p.getByRole('button', { name: /^Play/ }).first().click()
      await p.locator('.nudge').waitFor({ timeout: 30_000 })
      await p.waitForTimeout(500)
    },
  },
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
