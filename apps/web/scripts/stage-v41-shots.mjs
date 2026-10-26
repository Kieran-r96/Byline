// V4.1 tactical stage screenshots (PNG) from a RUNNING vite dev server; it starts no server itself.
//
//   npx vite --port 5197 --strictPort        (proxying /api to a cache-only backend)
//   node scripts/stage-v41-shots.mjs --png <dir> [--url http://localhost:5197] [--quick] [--only <name-substring>]
//
// Then convert to JPEG (quality 86) into docs/screenshots/v4.1/stage/ with tools/png2jpg.py.
// Default set: every step of T-option-NBA-0180 (pro at 1440x900, fan at 390x844), the continuation step for the
// other audience at each size, a moment whose continuation is a cross (BYLINE-03, 40'), a line break and a
// withdrawn picture.
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const BASE = arg('--url', 'http://localhost:5197')
const OUT = resolve(arg('--png', './stage-shots'))
const QUICK = args.includes('--quick')
const ONLY = arg('--only', null)

const SIG = 'T-option-NBA-0180'
const DESKTOP = { name: '1440', width: 1440, height: 900 }
const PHONE = { name: '390', width: 390, height: 844 }

const shots = []
const add = (s) => shots.push({ match: 'BYLINE-01', audience: 'pro', mode: 'explain', ...s })
for (let step = 1; step <= 7; step += 1) add({ moment: SIG, step, vp: DESKTOP })
if (!QUICK) {
  for (let step = 1; step <= 7; step += 1) add({ moment: SIG, step, vp: PHONE, audience: 'fan' })
  add({ moment: SIG, step: 6, vp: DESKTOP, audience: 'fan' })
  add({ moment: SIG, step: 6, vp: PHONE, audience: 'pro' })
  add({ match: 'BYLINE-03', moment: 'T-option-RVC-1104', step: 5, vp: DESKTOP })
  add({ match: 'BYLINE-03', moment: 'T-option-RVC-1104', step: 6, vp: DESKTOP })
  add({ match: 'BYLINE-03', moment: 'T-option-RVC-1104', step: 6, vp: PHONE, audience: 'fan' })
  add({ moment: 'T-line_break-NBA-0224', step: 3, vp: DESKTOP })
  // the real withdrawn moment: its evidence includes the goal VAR ruled out (reason as the signal states it)
  add({ moment: 'T-high_turnover-NBA-1999', step: 3, vp: DESKTOP, tag: 'withdrawn', withdrawn: "Withdrawn at 72': its evidence includes the goal ruled out by the official decision (E2009)." })
}

// In a git worktree whose node_modules is a junction, Vite may refuse /@fs/ files that resolve outside the
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
let taken = 0
try {
  for (const s of shots) {
    const kind = s.moment.split('-')[1]
    const name = `${s.match === 'BYLINE-01' ? '' : `${s.match}-`}${kind}-${s.moment.split('-').slice(2).join('-')}-step${s.step}${s.tag ? `-${s.tag}` : ''}-${s.audience}-${s.vp.name}.png`
    if (ONLY && !name.includes(ONLY)) continue
    const context = await browser.newContext({ viewport: { width: s.vp.width, height: s.vp.height }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.route('**/@fs/**/*.woff2', serveFs)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    const q = new URLSearchParams({ match: s.match, moment: s.moment, audience: s.audience, step: String(s.step), mode: s.mode })
    if (s.withdrawn) q.set('withdrawn', s.withdrawn)
    await page.goto(`${BASE}/stage.html?${q}`)
    await page.waitForFunction(() => window.__stage?.ready === true || !!window.__stage?.error, null, { timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: resolve(OUT, name), fullPage: true })
    taken += 1
    if (errors.length) {
      failures += 1
      console.error(`x ${name}: ${errors.join(' | ')}`)
    } else console.log(`ok ${name}`)
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(`${taken} shots -> ${OUT}${failures ? `, ${failures} with errors` : ''}`)
process.exit(failures ? 1 : 0)
