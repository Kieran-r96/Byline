// Screenshots of the tactical stage harness (stage.html) on a RUNNING vite dev server.
// It does not start any server itself.
//
//   npx vite --port 5199 --strictPort            (in another terminal; proxies /api to :8000)
//   node scripts/stage-screenshots.mjs [--url http://localhost:5199] [--out ../../docs/screenshots/v4/stage]
//                                      [--quick] [--moment <id>] [--timing]
//
// Default set: every step of T-option-NBA-0180 at 1440x900 and 390x844 (pro, plus fan at 390),
// choose mode before/after reveal, and the other moment kinds at 1440x900.
// --timing runs the steps with motion on and prints the measured frame intervals.
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const BASE = arg('--url', 'http://localhost:5199')
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, arg('--out', '../../../docs/screenshots/v4/stage'))
const QUICK = args.includes('--quick')
const ONLY = arg('--moment', null)
const TIMING = args.includes('--timing')

const SIGNATURE = 'T-option-NBA-0180'
const DESKTOP = { name: '1440', width: 1440, height: 900 }
const PHONE = { name: '390', width: 390, height: 844 }

const shots = []
const add = (moment, steps, vp, extra = {}) => {
  for (const step of steps) shots.push({ moment, step, vp, audience: 'pro', mode: 'explain', ...extra })
}
if (QUICK) {
  add(ONLY ?? SIGNATURE, [1, 2, 3, 4, 5], DESKTOP)
} else if (ONLY) {
  add(ONLY, [1, 2, 3, 4, 5], DESKTOP)
  add(ONLY, [1, 2, 3, 4, 5], PHONE)
} else {
  add(SIGNATURE, [1, 2, 3, 4, 5], DESKTOP)
  add(SIGNATURE, [1, 2, 3, 4, 5], PHONE)
  add(SIGNATURE, [1, 3, 4, 5], PHONE, { audience: 'fan' })
  shots.push({ moment: SIGNATURE, step: 1, vp: PHONE, audience: 'fan', mode: 'choose', tag: 'choose' })
  shots.push({ moment: SIGNATURE, step: 1, vp: PHONE, audience: 'fan', mode: 'choose', pick: 'NBA-11', reveal: true, tag: 'choose-revealed' })
  shots.push({ moment: SIGNATURE, step: 1, vp: DESKTOP, audience: 'fan', mode: 'choose', tag: 'choose' })
  add('T-line_break-NBA-0224', [1, 2, 3, 4], DESKTOP)
  add('T-overload-NBA-1624', [2, 3], DESKTOP)
  add('T-press-NBA-010', [2, 3], DESKTOP)
  add('T-shape_change-RVC-1957', [2, 3], DESKTOP)
  add('T-line_break-NBA-0224', [2, 3], PHONE)
}

// In a git worktree whose node_modules is a junction, Vite refuses /@fs/ files that resolve outside the
// worktree (fonts). Serve those straight from disk so screenshots use the real typeface.
const TYPES = { woff2: 'font/woff2', woff: 'font/woff', css: 'text/css', js: 'text/javascript' }
async function serveFs(route) {
  const url = new URL(route.request().url())
  const path = decodeURIComponent(url.pathname.replace(/^\/@fs\//, ''))
  try {
    const body = await readFile(path)
    await route.fulfill({ body, contentType: TYPES[path.split('.').pop()] ?? 'application/octet-stream' })
  } catch {
    await route.continue()
  }
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let failures = 0
try {
  for (const s of shots) {
    const context = await browser.newContext({ viewport: { width: s.vp.width, height: s.vp.height }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.route('**/@fs/**/*.woff2', serveFs)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    const q = new URLSearchParams({ moment: s.moment, audience: s.audience, step: String(s.step), mode: s.mode })
    await page.goto(`${BASE}/stage.html?${q}`)
    await page.waitForFunction(() => window.__stage?.ready === true || !!window.__stage?.error, null, { timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    if (s.pick) {
      await page.locator('.stage__choice', { hasText: 'Haddad-Rhys' }).click()
      if (s.reveal) await page.getByRole('button', { name: 'Show what happened' }).click()
    }
    await page.waitForTimeout(s.pick ? 4800 : 900)
    const kind = s.moment.split('-')[1]
    const name = `${kind}-${s.moment.split('-').slice(2).join('-')}-${s.tag ?? `step${s.step}`}-${s.audience}-${s.vp.name}.png`
    await page.screenshot({ path: resolve(OUT, name), fullPage: true })
    if (errors.length) {
      failures += 1
      console.error(`✗ ${name}: ${errors.join(' | ')}`)
    } else console.log(`✓ ${name}`)
    await context.close()
  }
  if (TIMING) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.route('**/@fs/**/*.woff2', serveFs)
    await page.goto(`${BASE}/stage.html?moment=${SIGNATURE}&stats=1`)
    await page.waitForFunction(() => window.__stage?.ready === true, null, { timeout: 30000 })
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab')
      await page.evaluate(() => window.__stage.handle.next())
      await page.waitForTimeout(3200)
    }
    const stats = await page.evaluate(() => window.__stage.handle.stats())
    console.log('frame intervals during step transitions (ms):', JSON.stringify(stats))
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(`${shots.length} shots -> ${OUT}${failures ? `, ${failures} with errors` : ''}`)
process.exit(failures ? 1 : 0)
