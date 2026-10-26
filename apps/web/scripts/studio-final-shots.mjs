// Final pass, Studio: programme feed, the four formats, the tactical corner box, the graphic families,
// the package builder and the VAR-blocked state, at 1440x900 and 1920x1080 (JPEG).
//   node scripts/studio-final-shots.mjs <out-dir> [--url http://localhost:4193] [--only name-substring]
// Needs the cache-only backend (BYLINE_API_PORT) behind the preview server given in --url.
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/final-pass/studio'
const url = arg('--url', 'http://localhost:4193')
const only = arg('--only', '')
mkdirSync(out, { recursive: true })

const SIZES = { desk: [1440, 900], wide: [1920, 1080] }

async function scrub(page, seconds) {
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(2600)
}
async function studio(page) {
  await page.getByRole('radio', { name: 'Studio', exact: true }).first().click()
  await page.waitForTimeout(500)
}
async function pick(page, re) {
  await page.locator('.q__item').filter({ hasText: re }).first().click()
  await page.waitForTimeout(900)
}
async function format(page, name) {
  await page.locator('.monitor[data-kind="pvw"] .fmt__opt').filter({ hasText: name }).click()
  await page.waitForTimeout(1300)
}
async function template(page, name) {
  await page.locator('.tpl__card').filter({ hasText: name }).first().click()
  await page.waitForTimeout(900)
}
async function take(page, wait = 1400) {
  await page.getByRole('button', { name: 'Take to air now' }).click()
  await page.waitForTimeout(wait)
}
async function showHistory(page) {
  const b = page.locator('.q__history')
  if ((await b.count()) && (await b.getAttribute('aria-expanded')) === 'false') await b.click()
}
async function desk(page, at, phase = 'Half-time') {
  await studio(page)
  await scrub(page, at)
  await page.getByRole('tab', { name: 'Analysis desk' }).click()
  await page.getByRole('tab', { name: phase }).click()
  await page.waitForTimeout(600)
}

const PVW = '.monitor[data-kind="pvw"] .gframe'
const PGM = '.monitor[data-kind="pgm"] .gframe'

// full-page scenes
const SCENES = [
  { name: 'programme-goal-on-air', run: async (p) => { await studio(p); await scrub(p, 1700); await pick(p, /GOAL/); await take(p) } },
  { name: 'programme-tactical-pip-on-air', run: async (p) => { await studio(p); await scrub(p, 500); await pick(p, /Better option on/); await take(p, 6500) } },
  { name: 'programme-full-screen-on-air', run: async (p) => { await studio(p); await scrub(p, 1700); await pick(p, /GOAL/); await format(p, 'Full-screen'); await take(p, 1600) } },
  { name: 'var-blocked', run: async (p) => { await studio(p); await scrub(p, 4400); await p.locator('.q__lane[data-lane="held"] .q__item').first().click(); await p.waitForTimeout(900) } },
  { name: 'withdrawn-blocked', run: async (p) => { await studio(p); await scrub(p, 4500); await p.locator('.q__lane[data-lane="withdrawn"] .q__item').first().click(); await p.waitForTimeout(900) } },
  { name: 'partner-template-spotlight', run: async (p) => { await studio(p); await scrub(p, 1700); await pick(p, /GOAL/); await template(p, 'Northgate'); await format(p, 'NG Player card'); await take(p, 1600) } },
  {
    name: 'package-builder',
    run: async (p) => {
      await desk(p, 2900)
      for (const re of [/Haddad-Rhys was open/, /breaks the lines/]) {
        await p.locator('.adesk__item').filter({ hasText: re }).first().click()
        await p.waitForTimeout(700)
        await p.getByRole('button', { name: 'Add to package' }).click()
      }
      await p.getByRole('button', { name: 'Add a stats panel' }).click()
      await p.locator('.rundown__move[aria-label^="Move Half-time stats panel up"]').click()
      await p.locator('.rundown__thumb').nth(1).click()
      await p.waitForTimeout(1500)
    },
  },
  {
    name: 'package-sent',
    run: async (p) => {
      await desk(p, 2900)
      await p.locator('.adesk__item').filter({ hasText: /Haddad-Rhys was open/ }).first().click()
      await p.waitForTimeout(700)
      await p.getByRole('button', { name: 'Add to package' }).click()
      await p.getByRole('button', { name: 'Add a stats panel' }).click()
      await p.getByRole('button', { name: /Send package to production/ }).click()
      await p.waitForTimeout(1800)
    },
  },
]

// preview-monitor crops: each family in each format it can carry
const CROPS = [
  { name: 'goal', at: 1700, re: /GOAL/, formats: ['Lower third', 'Corner box', 'Player spotlight', 'Full-screen'] },
  { name: 'substitution', at: 4400, re: /SUBSTITUTION/, formats: ['Lower third', 'Corner box', 'Player spotlight', 'Full-screen'] },
  { name: 'milestone', at: 1700, re: /^28'.*Record/, formats: ['Lower third', 'Corner box', 'Full-screen'] },
  { name: 'tactical', at: 500, re: /Better option on/, formats: ['Lower third', 'Full-screen'] },
  { name: 'decision', at: 2900, re: /OFFSIDE/, formats: ['Corner box', 'Full-screen'] },
  { name: 'stats', at: 2900, re: /HALF-TIME/, formats: ['Corner box', 'Full-screen'] },
]

const browser = await chromium.launch()
for (const scene of SCENES) {
  if (only && !scene.name.includes(only)) continue
  for (const size of Object.keys(SIZES)) {
    const [width, height] = SIZES[size]
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.log('pageerror', scene.name, e.message))
    await page.goto(url)
    await page.locator('.topbar').waitFor()
    await page.waitForTimeout(1500)
    try {
      await scene.run(page)
      await page.screenshot({ path: `${out}/${scene.name}-${width}.jpg`, type: 'jpeg', quality: 86 })
      console.log('wrote', scene.name, size)
    } catch (e) {
      console.log('FAILED', scene.name, size, String(e).split('\n')[0])
    }
    await page.close()
  }
}
for (const c of CROPS) {
  if (only && !`crop-${c.name}`.includes(only)) continue
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('pageerror', c.name, e.message))
  await page.goto(url)
  await page.locator('.topbar').waitFor()
  await page.waitForTimeout(1500)
  try {
    await studio(page)
    await scrub(page, c.at)
    await showHistory(page)
    await pick(page, c.re)
    for (const f of c.formats) {
      await format(page, f)
      const slug = f.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')
      await page.locator(PVW).screenshot({ path: `${out}/format-${c.name}-${slug}.jpg`, type: 'jpeg', quality: 88 })
      console.log('wrote', c.name, f)
    }
  } catch (e) {
    console.log('FAILED', c.name, String(e).split('\n')[0])
  }
  await page.close()
}
if (!only || only === 'pgm') {
  // the programme take: frames through a corner-box take and a full-screen take
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.goto(url)
  await page.locator('.topbar').waitFor()
  await page.waitForTimeout(1500)
  await studio(page)
  await scrub(page, 1700)
  await pick(page, /GOAL/)
  await format(page, 'Full-screen')
  await page.getByRole('button', { name: 'Take to air now' }).click()
  const t0 = Date.now()
  for (const ms of [120, 300, 900]) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
    await page.locator(PGM).screenshot({ path: `${out}/take-full-${ms}ms.jpg`, type: 'jpeg', quality: 86 })
  }
  await page.close()
}
await browser.close()
