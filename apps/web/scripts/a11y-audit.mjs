// Automated accessibility audit (axe-core) against a RUNNING `vite preview`
// + FastAPI backend. Drives the real UI into each state, then runs axe.
//
//   node scripts/a11y-audit.mjs [--url http://localhost:4173] [--only desktop|mobile] [--scene name] [--json out.json]
//
// Prints violation counts by impact per state and details for serious/critical.
// Exit code 1 if any serious or critical violation remains.
import { writeFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const BASE = arg('--url') ?? 'http://localhost:4173'
const ONLY = arg('--only')
const SCENE = arg('--scene')
const JSON_OUT = arg('--json')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
].filter((v) => !ONLY || v.name === ONLY)

async function fresh(browser, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 20_000 })
  await page.waitForSelector('.sp__player', { timeout: 20_000 })
  return { context, page }
}

async function setRole(page, vp, role) {
  await page.getByRole('radio', { name: role, exact: true }).first().click()
  await page.waitForTimeout(300)
}

async function jump(page, seconds) {
  await page.getByRole('radio', { name: '4 times speed' }).click({ timeout: 2000 }).catch(() => {})
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(1500)
}

async function fan(page, vp, mode) {
  await setRole(page, vp, 'Fan')
  await page.getByRole('radio', { name: mode, exact: true }).first().click()
  await page.waitForTimeout(300)
}

const scenes = {
  async prematch(page, vp) {
    await setRole(page, vp, 'Commentator')
  },
  async now(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 1800)
  },
  async research(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 1800)
    await page.locator('.sp__player').filter({ hasText: 'Vantreight' }).first().click()
    await page.waitForSelector('.sf__name', { timeout: 10_000 })
    await page.waitForSelector('.hero-fact__text', { timeout: 10_000 })
    await page.waitForTimeout(400)
  },
  async h2h(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 1800)
    await page.getByRole('button', { name: 'Riverton City club file' }).click()
    await page.getByRole('button', { name: 'Against Northbridge' }).click()
    await page.waitForSelector('.dz__meetings', { timeout: 10_000 })
  },
  async tactic(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 390)
    await page.locator('.moment').getByRole('button', { name: 'Show the play' }).first().click()
    await page.waitForSelector('[role="dialog"][aria-label="Tactical analysis"]', { timeout: 15_000 })
    await page.waitForTimeout(1500)
  },
  async evidence(page, vp) {
    await setRole(page, vp, 'Commentator')
    await jump(page, 1700)
    await page.getByRole('button', { name: 'Match so far' }).click()
    await page.getByRole('tab', { name: 'Developing' }).click()
    await page.locator('.hist .dev[data-kind="ai-story"]').getByRole('button', { name: 'See the evidence' }).first().click()
    await page.waitForSelector('.evidence__events', { timeout: 10_000 })
    await page.waitForTimeout(600)
  },
  async production(page, vp) {
    await setRole(page, vp, 'Studio')
    await jump(page, 4371)
    await page.locator('.q__item').first().click()
    await page.waitForTimeout(400)
  },
  async analysisdesk(page, vp) {
    await setRole(page, vp, 'Studio')
    await jump(page, 2900)
    await page.getByRole('tab', { name: 'Analysis desk' }).click()
    await page.waitForTimeout(1200)
  },
  async discover(page, vp) {
    await page.evaluate(() => localStorage.setItem('byline.fan.v4', JSON.stringify({ team: 'NBA', player: 'NBA-09', answers: { 'T-option-NBA-0180': 'NBA-11' } })))
    await page.reload()
    await page.waitForSelector('.topbar')
    await fan(page, vp, 'Discover')
    await jump(page, 500)
    await page.waitForSelector('.wyd__reveal', { timeout: 10_000 })
  },
  async analyst(page, vp) {
    await fan(page, vp, 'Analyst')
    await jump(page, 4500)
    await page.waitForTimeout(800)
  },
  async classic(page, vp) {
    await fan(page, vp, 'Classic')
    await jump(page, 1700)
  },
  async settings(page) {
    await page.getByRole('button', { name: 'Settings and system status' }).click()
    await page.waitForTimeout(300)
  },
  async recap(page) {
    await jump(page, 5767)
    await page.getByRole('button', { name: /recap/i }).filter({ visible: true }).first().click()
    await page.waitForSelector('.recap__article', { timeout: 10_000 })
    await page.waitForTimeout(400)
  },
}

const browser = await chromium.launch()
const results = []
let blocking = 0
try {
  for (const vp of VIEWPORTS) {
    for (const [name, fn] of Object.entries(scenes)) {
      if (SCENE && SCENE !== name) continue
      const { context, page } = await fresh(browser, vp)
      try {
        await fn(page, vp)
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze()
        const count = { critical: 0, serious: 0, moderate: 0, minor: 0 }
        for (const v of r.violations) count[v.impact ?? 'minor'] += v.nodes.length
        console.log(`${vp.name} ${name}: critical ${count.critical} serious ${count.serious} moderate ${count.moderate} minor ${count.minor}`)
        for (const v of r.violations) {
          if (v.impact === 'serious' || v.impact === 'critical') blocking += v.nodes.length
          const targets = v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')
          console.log(`   [${v.impact}] ${v.id} x${v.nodes.length}: ${targets}`)
        }
        results.push({ viewport: vp.name, scene: name, count, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) })
      } catch (e) {
        blocking += 1
        console.log(`${vp.name} ${name}: FAILED to reach state: ${e.message.split('\n')[0]}`)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(results, null, 2))
console.log(`serious+critical nodes: ${blocking}`)
process.exitCode = blocking ? 1 : 0
