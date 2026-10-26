// Empty / error / loading states + reduced motion (T021). Needs a RUNNING
// `vite preview` + backend; failure states are simulated in the browser only.
//
//   node scripts/states-screenshots.mjs [--url http://localhost:4173]
//
// Output: apps/web/screenshots/t021-*.png
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:4173'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
let failures = 0
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `t021-${name}.png`) })
  console.log(`saved t021-${name}.png`)
}
const ctx = (opts = {}) => browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ...opts })
const ready = (page) => page.waitForSelector('.mt[data-loading="false"]', { timeout: 20_000 })

/** Fraction of differing pixels in a fixed canvas region between two moments. */
async function cameraDrift(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('.mt__canvas')
    const grab = async () => {
      const bmp = await createImageBitmap(canvas)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      const g = c.getContext('2d')
      g.drawImage(bmp, 0, 0)
      // Top band of the frame: hoardings, far touchline and goal frames; players rarely enter it.
      return g.getImageData(0, 0, c.width, Math.round(c.height * 0.12)).data
    }
    const a = await grab()
    await new Promise((r) => setTimeout(r, 2500))
    const b = await grab()
    let diff = 0
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff += 1
    }
    return diff / (a.length / 4)
  })
}

try {
  // 1. Backend down: every API call fails.
  {
    const c = await ctx()
    const page = await c.newPage()
    await page.route('**/api/**', (r) => r.abort())
    await page.route('**/healthz', (r) => r.abort())
    await page.goto(BASE)
    await page.waitForSelector('.service-banner', { timeout: 15_000 })
    await page.waitForTimeout(800)
    await shot(page, 'backend-down')
    await c.close()
  }
  // 2. AI degraded (status rewritten in the browser; match data is real).
  {
    const c = await ctx()
    const page = await c.newPage()
    await page.route('**/api/system/status', async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      body.ai = { ...body.ai, provider: 'foundry', state: 'degraded', cache_only: false }
      await route.fulfill({ response: res, json: body })
    })
    await page.goto(BASE)
    await ready(page)
    await page.getByRole('slider', { name: 'Replay position' }).fill('1700')
    await page.waitForSelector('.story', { timeout: 15_000 })
    await page.waitForTimeout(600)
    await shot(page, 'ai-degraded')
    await c.close()
  }
  // 3. No stories yet (kick-off) and 4. recap before full time.
  {
    const c = await ctx()
    const page = await c.newPage()
    await page.goto(BASE)
    await ready(page)
    await page.waitForTimeout(600)
    await shot(page, 'no-stories')
    await page.getByRole('button', { name: 'Recap' }).click()
    await page.waitForSelector('.recap__state-title', { timeout: 10_000 })
    await page.waitForTimeout(400)
    await shot(page, 'recap-before-ft')
    await c.close()
  }
  // 5. Reduced motion: static full-pitch camera, no slide animations.
  for (const reduced of [true, false]) {
    const c = await ctx({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await c.newPage()
    await page.goto(BASE)
    await ready(page)
    await page.getByRole('radio', { name: '4 times speed' }).click()
    await page.getByRole('slider', { name: 'Replay position' }).fill('600')
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Play replay' }).click()
    await page.waitForTimeout(1500)
    const drift = await cameraDrift(page)
    const toggle = await page.locator('.mt__camera').count()
    const drawer = await page.evaluate(() => {
      const el = document.querySelector('.drawer__panel')
      return el ? getComputedStyle(el).transitionDuration : 'n/a'
    })
    console.log(`reducedMotion=${reduced}: top-band change over 2.5 s ${(drift * 100).toFixed(2)}% | camera toggle shown ${toggle > 0} | drawer transition ${drawer}`)
    if (reduced) {
      if (drift > 0.02 || toggle > 0) failures += 1
      await shot(page, 'reduced-motion')
    }
    await c.close()
  }
} catch (e) {
  failures += 1
  console.log(`FAILED: ${e.message.split('\n')[0]}`)
} finally {
  await browser.close()
}
process.exitCode = failures ? 1 : 0
