// Gate E captures against a RUNNING `vite preview` + FastAPI backend
// (cache-only Foundry recordings: BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true).
//
//   node scripts/gate-e-screenshots.mjs [--url http://localhost:4173] [--only desktop|laptop|tablet|mobile] [--scene name]
//
// Drives the real UI only (role switch, scrub, play, tabs, drawers). Output:
// apps/web/screenshots/gate-e-<viewport>-<scene>.png
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const BASE = arg('--url') ?? 'http://localhost:4173'
const ONLY = arg('--only')
const SCENE = arg('--scene')
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
].filter((v) => !ONLY || v.name === ONLY)

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
let failures = 0

const isMobile = (vp) => vp.width < 768
const isDesktop = (vp) => vp.width >= 1024

async function fresh(vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForSelector('.mt[data-loading="false"]', { timeout: 20_000 })
  return { context, page, errors }
}

async function setRole(page, vp, role) {
  if (isMobile(vp)) {
    await page.getByRole('button', { name: /^View/ }).click()
    await page.getByRole('radio', { name: role }).click()
    await page.getByRole('button', { name: 'Close View' }).click()
  } else {
    await page.getByRole('radio', { name: role }).first().click()
  }
  await page.waitForTimeout(300)
}

async function setFanMode(page, vp, mode) {
  if (isMobile(vp)) {
    await page.getByRole('button', { name: /^View/ }).click()
    await page.getByRole('radio', { name: mode }).click()
    await page.getByRole('button', { name: 'Close View' }).click()
  } else {
    await page.getByRole('radio', { name: mode }).first().click()
  }
  await page.waitForTimeout(300)
}

async function jump(page, seconds, speed = '4') {
  await page.getByRole('radio', { name: `${speed} times speed` }).click()
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(700)
}
const play = (page) => page.getByRole('button', { name: 'Play replay' }).click()
const pause = (page) => page.getByRole('button', { name: 'Pause replay' }).click().catch(() => {})

async function openPanel(page, vp, tab) {
  if (isDesktop(vp)) {
    if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    return
  }
  if (isMobile(vp)) await page.getByRole('button', { name: /^(Stories|Desk)/ }).click()
  else await page.getByRole('button', { name: /^Show match centre/ }).click()
  await page.waitForTimeout(450)
  if (tab) await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
  await page.waitForTimeout(250)
}

async function shot(page, vp, scene) {
  const file = resolve(OUT, `gate-e-${vp.name}-${scene}.png`)
  await page.screenshot({ path: file })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(`${vp.name} ${scene}: overflow ${overflow}px`)
  if (overflow > 0) failures += 1
}

const scenes = {
  // T011: second yellow 64' (live prompt + explainer)
  async decisions(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 3910)
    await play(page)
    await page.waitForSelector('.decision-callout', { timeout: 15_000 })
    await page.waitForTimeout(500)
    await pause(page)
    await shot(page, vp, 'decision-callout')
    await page.getByRole('button', { name: 'Why that decision?' }).first().click()
    await page.waitForTimeout(600)
    await shot(page, vp, 'decision-second-yellow')
  },
  // T011: VAR check 71'-72'
  async var(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 4372)
    await play(page)
    await page.waitForSelector('.mt__var', { timeout: 15_000 })
    await page.waitForTimeout(1500)
    await pause(page)
    await openPanel(page, vp, 'Decisions')
    const card = page.locator('.decision').filter({ hasText: 'VAR CHECK' }).first()
    await card.getByRole('button', { name: 'Why that decision?' }).click()
    await page.waitForTimeout(500)
    await shot(page, vp, 'decision-var')
  },
  // T016: formation, player drawer, used toast
  async formation(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 4000)
    if (isMobile(vp)) await page.getByRole('button', { name: /^Teams/ }).click()
    else if (isDesktop(vp)) await page.getByRole('tab', { name: /^Line-ups/ }).click()
    await page.waitForTimeout(500)
    await page.getByRole('radio', { name: 'Riverton City' }).click()
    await page.waitForTimeout(300)
    if (!isMobile(vp)) await page.locator('#match-theatre').scrollIntoViewIfNeeded()
    await shot(page, vp, 'formation')
    await page.getByRole('radio', { name: 'Northbridge Athletic' }).click()
    await page.getByRole('button', { name: /Nico Vantreight/ }).click()
    await page.waitForSelector('.fact', { timeout: 10_000 })
    await page.waitForTimeout(400)
    await shot(page, vp, 'player-drawer')
    await page.getByRole('button', { name: 'Mark used' }).first().click()
    await page.waitForTimeout(400)
    await shot(page, vp, 'used-toast')
  },
  // T017: fan modes at the same moment (after the 28' verified story)
  async fan(page, vp) {
    await setRole(page, vp, 'Fan')
    await jump(page, 1700)
    for (const mode of ['Classic', 'Discover', 'Analyst']) {
      await setFanMode(page, vp, mode)
      await page.waitForTimeout(700)
      if (mode !== 'Classic' && isMobile(vp)) await openPanel(page, vp)
      await shot(page, vp, `fan-${mode.toLowerCase()}`)
      if (mode !== 'Classic' && isMobile(vp)) await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
  },
  // T018: studio desk, on-air lower third, then the same goal graphic retracted at 72'
  async studio(page, vp) {
    await setRole(page, vp, 'Studio')
    await jump(page, 4371)
    await page.waitForTimeout(500)
    await openPanel(page, vp)
    const goal = page.locator('.desk__item').filter({ has: page.locator('.desk__title', { hasText: /^GOAL/ }) }).filter({ hasText: 'Awaiting review' }).first()
    await goal.getByRole('button', { name: 'Approve' }).click()
    await page.waitForSelector('.onair .lt', { timeout: 10_000 })
    if (!isDesktop(vp)) await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await shot(page, vp, 'studio-on-air')
    // play through (no seek, so the approval history is kept) to the VAR outcome
    await page.getByRole('radio', { name: '30 times speed' }).click()
    await play(page)
    await page.waitForFunction(() => (document.querySelector('.replay__elapsed')?.textContent ?? '') >= '74:00', null, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    await pause(page)
    await openPanel(page, vp)
    await page.waitForTimeout(500)
    await shot(page, vp, 'studio-retracted')
  },
  // T020: Spanish machine translation of verified stories (English fallback per field)
  async spanish(page, vp) {
    await page.getByRole('button', { name: 'Settings and system status' }).click()
    await page.getByRole('radio', { name: /Español/ }).check()
    await page.keyboard.press('Escape')
    await setRole(page, vp, 'Fan')
    await setFanMode(page, vp, 'Discover')
    await jump(page, 3480)
    await page.waitForTimeout(800)
    await openPanel(page, vp)
    await page.waitForTimeout(400)
    await shot(page, vp, 'spanish')
  },
  // Match picker: Discipline & VAR scenario, decision explainer breadth
  async match02(page, vp) {
    await page.getByRole('button', { name: 'Settings and system status' }).click()
    await page.getByRole('radio', { name: /Discipline & VAR/ }).check()
    await page.keyboard.press('Escape')
    await page.waitForSelector('.mt[data-loading="false"]', { timeout: 20_000 })
    await page.waitForTimeout(800)
    await setRole(page, vp, 'Commentator')
    await jump(page, 4150)
    await page.waitForTimeout(800)
    await openPanel(page, vp, 'Decisions')
    const card = page.locator('.decision').filter({ hasText: 'PENALTY RETAKE' }).first()
    await card.getByRole('button', { name: 'Why that decision?' }).click()
    await page.waitForTimeout(500)
    await shot(page, vp, 'match02-decisions')
  },
  async recap(page, vp) {
    await jump(page, 5767)
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: /recap/i }).filter({ visible: true }).first().click()
    await page.waitForSelector('.recap__article', { timeout: 10_000 })
    await page.waitForTimeout(500)
    await shot(page, vp, 'recap')
  },
}

try {
  for (const vp of VIEWPORTS) {
    for (const [name, fn] of Object.entries(scenes)) {
      if (SCENE && SCENE !== name) continue
      const { context, page, errors } = await fresh(vp)
      try {
        await fn(page, vp)
      } catch (e) {
        failures += 1
        console.log(`${vp.name} ${name}: FAILED ${e.message.split('\n')[0]}`)
        await page.screenshot({ path: resolve(OUT, `gate-e-${vp.name}-${name}-FAILED.png`) })
      }
      if (errors.length) {
        failures += 1
        console.log(`${vp.name} ${name}: page errors ${errors.join(' | ')}`)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
process.exitCode = failures ? 1 : 0
