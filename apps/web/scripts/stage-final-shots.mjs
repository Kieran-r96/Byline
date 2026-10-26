// Final-pass tactical stage screenshots (JPEG) from a RUNNING vite dev server; it starts no server itself.
//
//   BYLINE_API_PORT=8102 npx vite --port 5192 --strictPort      (proxying /api to a cache-only backend)
//   node scripts/stage-final-shots.mjs [--out <dir>] [--url http://localhost:5192] [--only <name-substring>]
//
// Default set: every step of the 7' moment (T-option-NBA-0180) at 1440x900 for both audiences, and the Studio
// clip (picture-in-picture) at 320x180 and 480x270 on the steps that carry the story.
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const BASE = arg('--url', 'http://localhost:5192')
const OUT = resolve(arg('--out', '../../docs/screenshots/final-pass/stage'))
const ONLY = arg('--only', null)
const SIG = 'T-option-NBA-0180'
const STEPS = Number(arg('--steps', '8'))
// --svg: WebGL disabled, so the stage draws its SVG fallback (checks the two renderers stay in step)
const SVG = args.includes('--svg')

const shots = []
if (SVG) {
  for (const step of [3, 5, 6, 7, 8]) shots.push({ name: `0180-svg-step${step}-fan-1440`, q: { audience: 'fan', step }, vp: [1440, 900] })
} else {
  for (const audience of ['fan', 'pro']) {
    for (let step = 1; step <= STEPS; step += 1) shots.push({ name: `0180-step${step}-${audience}-1440`, q: { audience, step }, vp: [1440, 900] })
  }
  for (const [w, h] of [[320, 180], [480, 270]]) {
    for (const step of [3, 5, 6, 7]) shots.push({ name: `0180-clip-step${step}-${w}x${h}`, q: { audience: 'pro', step, clip: 1, hold: 1, w, h }, vp: [w + 40, h + 40], clip: true })
  }
}

// In a git worktree Vite may refuse /@fs/ font files that resolve outside the worktree: serve them from disk.
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
const browser = await chromium.launch({ args: SVG ? ['--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
let failures = 0
let taken = 0
try {
  for (const s of shots) {
    if (ONLY && !s.name.includes(ONLY)) continue
    const context = await browser.newContext({ viewport: { width: s.vp[0], height: s.vp[1] }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    await page.route('**/@fs/**/*.woff2', serveFs)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    const q = new URLSearchParams({ match: 'BYLINE-01', moment: SIG, mode: 'explain', ...Object.fromEntries(Object.entries(s.q).map(([k, v]) => [k, String(v)])) })
    await page.goto(`${BASE}/stage.html?${q}`)
    await page.waitForFunction(() => window.__stage?.ready === true || !!window.__stage?.error, null, { timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1500)
    const path = resolve(OUT, `${s.name}.jpg`)
    if (s.clip) await page.locator('[data-testid="clip-box"]').screenshot({ path, type: 'jpeg', quality: 88 })
    else await page.screenshot({ path, type: 'jpeg', quality: 86, fullPage: true })
    taken += 1
    if (errors.length) {
      failures += 1
      console.error(`x ${s.name}: ${errors.join(' | ')}`)
    } else console.log(`ok ${s.name}`)
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(`${taken} shots -> ${OUT}${failures ? `, ${failures} with errors` : ''}`)
process.exit(failures ? 1 : 0)
