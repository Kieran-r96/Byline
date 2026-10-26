// R2 review set: every audience and key state at the blueprint's breakpoints, from the real app.
//   node scripts/review-shots.mjs <out-dir> [--url http://localhost:4173]   (cache-only backend at 127.0.0.1:8000)
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const out = process.argv[2] ?? '../../docs/screenshots/r2'
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4173'
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.goto(url)
  await page.locator('.mt[data-loading="false"]').waitFor()
  return page
}
async function role(page, name, fan) {
  const radio = page.getByRole('radio', { name, exact: true }).first()
  if (!(await radio.isVisible())) {
    // phone layout: the role and fan mode live behind the View button
    await page.getByRole('button', { name: /^View/ }).first().click()
  }
  await page.getByRole('radio', { name, exact: true }).first().click()
  if (fan) await page.getByRole('radio', { name: fan, exact: true }).first().click()
  await page.keyboard.press('Escape')
}
async function at(page, seconds) {
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(seconds))
  await page.waitForTimeout(1500)
}
async function shot(page, name) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('wrote', name)
}
const scenes = {
  async 'desktop-commentator'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 1660); await shot(p, 'desktop-commentator'); return p
  },
  async 'desktop-developing'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 1530); await shot(p, 'desktop-developing'); return p
  },
  async 'desktop-evidence'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 1660)
    await p.locator('.story').first().getByRole('button', { name: 'Show why' }).click()
    await p.waitForTimeout(1200); await shot(p, 'desktop-evidence'); return p
  },
  async 'desktop-replay'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 3620)
    await p.locator('.story').filter({ hasText: /overlapping/i }).first().getByRole('button', { name: 'Show why' }).click()
    await p.getByRole('button', { name: 'Replay evidence' }).click()
    await p.waitForTimeout(5200); await shot(p, 'desktop-replay'); return p
  },
  async 'live-sequence'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 1580)
    await p.getByRole('radio', { name: '1 times speed' }).click()
    await p.getByRole('button', { name: 'Play replay' }).click()
    for (let i = 0; i < 4; i += 1) {
      await p.waitForTimeout(1500)
      await p.locator('.mt').screenshot({ path: `${out}/live-${i}.png` })
    }
    console.log('wrote live-0..3'); return p
  },
  async 'fan-companion'() {
    const p = await open(1440, 900); await role(p, 'Fan', 'Discover'); await at(p, 4500); await p.waitForTimeout(2500)
    await shot(p, 'fan-companion'); return p
  },
  async 'fan-companion-analyst'() {
    const p = await open(1440, 900); await role(p, 'Fan', 'Analyst'); await at(p, 4500); await p.waitForTimeout(2500)
    await shot(p, 'fan-companion-analyst'); return p
  },
  async 'mobile-companion'() {
    const p = await open(390, 844); await role(p, 'Fan', 'Discover'); await at(p, 4500)
    await p.getByRole('button', { name: /Stories/ }).last().click(); await p.waitForTimeout(2500)
    await shot(p, 'mobile-companion'); return p
  },
  async 'alert-plate'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 1610)
    await p.getByRole('radio', { name: '4 times speed' }).click()
    await p.getByRole('button', { name: 'Play replay' }).click()
    await p.locator('.alert-plate').waitFor({ timeout: 40_000 }); await p.waitForTimeout(500)
    await shot(p, 'alert-plate'); return p
  },
  async 'studio-tactics'() {
    const p = await open(1440, 900); await role(p, 'Studio'); await at(p, 520); await p.waitForTimeout(3500)
    await shot(p, 'studio-tactics'); return p
  },
  async 'desktop-player'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 4000)
    await p.getByRole('tab', { name: /Line-ups/ }).click()
    await p.getByRole('button', { name: /^Nico Vantreight/ }).first().click()
    await p.getByRole('dialog', { name: 'Player facts' }).locator('.fact').first().waitFor()
    await shot(p, 'desktop-player'); return p
  },
  async 'desktop-var'() {
    const p = await open(1440, 900); await role(p, 'Commentator'); await at(p, 4455); await p.waitForTimeout(1500); await shot(p, 'desktop-var'); return p
  },
  async 'desktop-studio'() {
    const p = await open(1440, 900); await role(p, 'Studio'); await at(p, 4371); await p.waitForTimeout(3500); await shot(p, 'desktop-studio'); return p
  },
  async 'desktop-fan-classic'() {
    const p = await open(1440, 900); await role(p, 'Fan', 'Classic'); await at(p, 1660); await shot(p, 'desktop-fan-classic'); return p
  },
  async 'desktop-fan-discover'() {
    const p = await open(1440, 900); await role(p, 'Fan', 'Discover'); await at(p, 1660); await shot(p, 'desktop-fan-discover'); return p
  },
  async 'desktop-fan-analyst'() {
    const p = await open(1440, 900); await role(p, 'Fan', 'Analyst'); await at(p, 1660); await shot(p, 'desktop-fan-analyst'); return p
  },
  async 'laptop-commentator'() {
    const p = await open(1280, 800); await role(p, 'Commentator'); await at(p, 1660); await shot(p, 'laptop-commentator'); return p
  },
  async 'tablet-landscape'() {
    const p = await open(1024, 768); await role(p, 'Commentator'); await at(p, 1660); await shot(p, 'tablet-landscape'); return p
  },
  async 'tablet-portrait'() {
    const p = await open(820, 1180); await role(p, 'Commentator'); await at(p, 4000); await shot(p, 'tablet-portrait'); return p
  },
  async 'mobile-fan'() {
    const p = await open(390, 844); await role(p, 'Fan', 'Discover'); await at(p, 1660); await shot(p, 'mobile-fan'); return p
  },
  async 'mobile-fan-classic'() {
    const p = await open(390, 844); await role(p, 'Fan', 'Classic'); await at(p, 1660); await shot(p, 'mobile-fan-classic'); return p
  },
}
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.includes(name)) continue
  try {
    const p = await fn()
    await p.close()
  } catch (e) {
    console.log('FAILED', name, String(e).split('\n')[0])
  }
}
await browser.close()
