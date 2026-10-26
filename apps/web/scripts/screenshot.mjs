// Screenshots a RUNNING `vite preview` (default http://127.0.0.1:4173).
// It does not start any server itself.
//
//   npm run build && npx vite preview --port 4173   (in another terminal)
//   node scripts/screenshot.mjs [--url http://127.0.0.1:4173] [--mock-backend]
//
// --mock-backend intercepts /healthz and /api/system/status in the browser
// with a clearly-labelled "AI off" payload, to review the online state when
// the FastAPI backend is not running. Output: apps/web/screenshots/*.png
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const urlArg = args.indexOf('--url')
const BASE = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:4173'
const MOCK = args.includes('--mock-backend')
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'tablet-820x1180', width: 820, height: 1180 },
  { name: 'mobile-390x844', width: 390, height: 844 },
]

const MOCK_STATUS = {
  ai: { provider: 'off', state: 'disabled', deployment: null, calls_used: 0, calls_cap: 0 },
  synthetic: true,
  version: 'screenshot-mock',
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
let failures = 0

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    if (MOCK) {
      await page.route('**/healthz', (r) => r.fulfill({ json: { status: 'ok' } }))
      await page.route('**/api/system/status', (r) => r.fulfill({ json: MOCK_STATUS }))
    }

    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // Give the first health check (and, if offline, its banner) time to settle.
    await page.waitForTimeout(1500)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    const suffix = MOCK ? '-backend-mocked' : ''
    const file = resolve(OUT, `${vp.name}${suffix}.png`)
    await page.screenshot({ path: file })
    console.log(`${vp.name}: saved ${file} | horizontal overflow ${overflow}px | page errors ${errors.length}`)
    if (overflow > 0 || errors.length) failures += 1
    for (const e of errors) console.log(`  error: ${e}`)

    // Secondary states: tablet slide-over drawer, mobile Stories sheet.
    if (vp.name.startsWith('tablet')) {
      await page.getByRole('button', { name: 'Show Story Radar' }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(OUT, `${vp.name}-drawer${suffix}.png`) })
    }
    if (vp.name.startsWith('mobile')) {
      await page.getByRole('button', { name: 'Stories' }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(OUT, `${vp.name}-stories${suffix}.png`) })
    }

    await context.close()
  }
} finally {
  await browser.close()
}

process.exitCode = failures ? 1 : 0
