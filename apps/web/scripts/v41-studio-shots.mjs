// V4.1 Studio: screenshots of live production, the graphic families, the partner template and the analysis desk.
//   node scripts/v41-studio-shots.mjs <out-dir> [--url http://localhost:5198] [--only name-substring] [--sizes desk,wide]
// Needs the cache-only backend on :8000 and a web server for --url. Writes PNG (convert to JPEG afterwards).
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/v4.1/studio'
const url = arg('--url', 'http://localhost:5198')
const only = arg('--only', '')
const sizesArg = arg('--sizes', '')
mkdirSync(out, { recursive: true })

const SIZES = { desk: [1440, 900], wide: [1920, 1080], tablet: [1024, 768] }

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
async function template(page, name) {
  await page.locator('.tpl__card').filter({ hasText: name }).first().click()
  await page.waitForTimeout(900)
}
async function showHistory(page) {
  const b = page.locator('.q__history')
  if ((await b.count()) && (await b.getAttribute('aria-expanded')) === 'false') await b.click()
}

const SCENES = [
  { name: 'production-review', sizes: ['desk', 'wide', 'tablet'], run: async (p) => { await studio(p); await scrub(p, 1700); await p.waitForTimeout(800) } },
  { name: 'goal-on-air', sizes: ['desk', 'wide'], run: async (p) => { await studio(p); await scrub(p, 1700); await pick(p, /GOAL/); await p.getByRole('button', { name: 'Take to air now' }).click(); await p.waitForTimeout(1400) } },
  { name: 'tactical-clip-on-air', sizes: ['desk', 'wide'], run: async (p) => { await studio(p); await scrub(p, 500); await pick(p, /Better option on/); await p.getByRole('button', { name: 'Take to air now' }).click(); await p.waitForTimeout(6500) } },
  { name: 'partner-template', sizes: ['desk', 'wide'], run: async (p) => { await studio(p); await scrub(p, 1700); await pick(p, /GOAL/); await template(p, 'Northgate'); await p.getByRole('button', { name: 'Take to air now' }).click(); await p.waitForTimeout(1400) } },
  { name: 'partner-template-tactical', sizes: ['desk'], run: async (p) => { await studio(p); await scrub(p, 500); await pick(p, /Better option on/); await template(p, 'Northgate'); await p.waitForTimeout(4000) } },
  { name: 'var-held', sizes: ['desk'], run: async (p) => { await studio(p); await scrub(p, 4400); await p.locator('.q__lane[data-lane="held"] .q__item').first().click(); await p.waitForTimeout(900) } },
  { name: 'analysis-desk', sizes: ['desk', 'wide', 'tablet'], run: async (p) => { await studio(p); await scrub(p, 2900); await p.getByRole('tab', { name: 'Analysis desk' }).click(); await p.getByRole('tab', { name: 'Half-time' }).click(); await p.locator('.adesk__item').filter({ hasText: /Haddad-Rhys was open/ }).click(); await p.waitForTimeout(3500) } },
  { name: 'analysis-package', sizes: ['desk'], run: async (p) => { await studio(p); await scrub(p, 2900); await p.getByRole('tab', { name: 'Analysis desk' }).click(); await p.getByRole('tab', { name: 'Half-time' }).click(); await p.locator('.adesk__item').filter({ hasText: /Haddad-Rhys was open/ }).click(); await p.waitForTimeout(1500); await p.getByRole('button', { name: 'Add to package' }).click(); await p.getByRole('button', { name: 'Add a stats panel' }).click(); await p.getByRole('button', { name: 'Send to production' }).first().click(); await p.waitForTimeout(1500) } },
]

// one preview-monitor crop per graphic family, in both templates
const FAMILIES = [
  { name: 'spotlight', at: 1700, re: /GOAL/ },
  { name: 'breakthrough', at: 500, re: /Better option on/ },
  { name: 'milestone', at: 1700, re: /^28'.*Record/ },
  { name: 'change', at: 4400, re: /SUBSTITUTION/ },
  { name: 'comparison', at: 2900, re: /HALF-TIME/ },
  { name: 'decision', at: 2900, re: /OFFSIDE/ },
  { name: 'story', at: 1700, re: /Right Channel/ },
]

const browser = await chromium.launch()
const sizes = (s) => (sizesArg ? sizesArg.split(',') : s)

// the on-air choreography: programme-monitor frames after Take to air now, then after Take off air
if (only === 'motion') {
  for (const [label, at, re] of [['goal', 1700, /GOAL/], ['decision', 2900, /OFFSIDE/], ['stats', 2900, /HALF-TIME/]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    await page.goto(url)
    await page.locator('.topbar').waitFor()
    await page.waitForTimeout(1500)
    await studio(page)
    await scrub(page, at)
    await pick(page, re)
    const pgm = page.locator('.monitor[data-kind="pgm"] .gframe')
    await page.getByRole('button', { name: 'Take to air now' }).click()
    const t0 = Date.now()
    for (const ms of [60, 200, 340, 480, 900]) {
      await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
      await pgm.screenshot({ path: `${out}/motion-${label}-in-${ms}.png` })
    }
    await page.getByRole('button', { name: 'Take off air' }).click()
    const t1 = Date.now()
    for (const ms of [120, 300]) {
      await page.waitForTimeout(Math.max(0, ms - (Date.now() - t1)))
      await pgm.screenshot({ path: `${out}/motion-${label}-out-${ms}.png` })
    }
    console.log('wrote motion', label)
    await page.close()
  }
}
for (const scene of SCENES) {
  if (only && !scene.name.includes(only)) continue
  for (const size of sizes(scene.sizes)) {
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
if (!only || 'families'.includes(only) || FAMILIES.some((f) => f.name.includes(only))) {
  for (const tpl of ['BYLINE house', 'Northgate']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.log('pageerror families', e.message))
    await page.goto(url)
    await page.locator('.topbar').waitFor()
    await page.waitForTimeout(1500)
    await studio(page)
    let at = -1
    for (const f of FAMILIES) {
      if (only && only !== 'families' && !f.name.includes(only)) continue
      try {
        if (f.at !== at) {
          await scrub(page, f.at)
          at = f.at
        }
        await showHistory(page)
        await pick(page, f.re)
        await template(page, tpl)
        await page.waitForTimeout(f.name === 'breakthrough' ? 1800 : 900)
        await page.locator('.monitor[data-kind="pvw"] .gframe').screenshot({ path: `${out}/family-${f.name}-${tpl.startsWith('B') ? 'house' : 'northgate'}.png` })
        console.log('wrote family', f.name, tpl)
      } catch (e) {
        console.log('FAILED family', f.name, tpl, String(e).split('\n')[0])
      }
    }
    await page.close()
  }
}
await browser.close()
