// Fan review shots (real app, cache-only backend), JPEG at desktop and phone.
//   node scripts/fan-shots.mjs <out-dir> [--url http://localhost:4173] [--only name-substring]
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const out = process.argv[2] ?? '../../docs/screenshots/final-pass/fan'
const url = arg('--url', 'http://localhost:4173')
const only = arg('--only', '')
mkdirSync(out, { recursive: true })

const SIZES = { desk: [1440, 900], phone: [390, 844] }
const ONLY_SIZE = arg('--size', '')
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
const fan = async (p, state, mode, at) => {
  await fanState(p, state)
  await role(p, 'Fan')
  await role(p, mode)
  await scrub(p, at)
}

const SCENES = [
  { name: 'crest-picker', run: (p) => fan(p, null, 'Discover', 30) },
  { name: 'player-pick', run: (p) => fan(p, { team: 'NBA', player: null, answers: {} }, 'Discover', 30) },
  { name: 'discover-7m', run: (p) => fan(p, { team: 'NBA', player: 'NBA-04', answers: {} }, 'Discover', 400) },
  { name: 'discover-30m', run: (p) => fan(p, { team: 'NBA', player: 'NBA-09', answers: { 'T-option-NBA-0180': 'NBA-11' } }, 'Discover', 1800) },
  {
    name: 'perspective-switched',
    run: async (p) => {
      await fan(p, { team: 'NBA', player: 'NBA-09', answers: {} }, 'Discover', 2600)
      await p.getByRole('radiogroup', { name: 'Your side' }).getByRole('radio', { name: 'Riverton' }).click()
      await p.waitForTimeout(900)
    },
  },
  {
    name: 'comparison-open',
    run: async (p) => {
      await fan(p, { team: 'NBA', player: 'NBA-09', answers: {} }, 'Discover', 1800)
      await p.getByRole('button', { name: /^Compare/ }).click()
      await p.waitForTimeout(900)
    },
  },
  { name: 'analyst', run: (p) => fan(p, { team: 'NBA', player: 'NBA-09', answers: {} }, 'Analyst', 1800) },
  { name: 'classic', run: (p) => fan(p, { team: 'NBA', player: 'NBA-09', answers: {} }, 'Classic', 1800) },
]

const browser = await chromium.launch()
for (const scene of SCENES) {
  if (only && !scene.name.includes(only)) continue
  for (const [size, [width, height]] of Object.entries(SIZES)) {
    if (ONLY_SIZE && size !== ONLY_SIZE) continue
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.log('pageerror', scene.name, e.message))
    await page.goto(url)
    await page.locator('.topbar').waitFor()
    await page.waitForTimeout(1500)
    try {
      await scene.run(page)
      await page.screenshot({ path: `${out}/${scene.name}-${size}.jpg`, type: 'jpeg', quality: 82 })
      console.log('wrote', scene.name, size)
    } catch (e) {
      console.log('FAILED', scene.name, size, String(e).split('\n')[0])
    }
    await page.close()
  }
}
await browser.close()
