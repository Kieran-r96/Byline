// T009 acceptance captures against a RUNNING `vite preview` + FastAPI backend.
//
//   (backend)  cd apps/api && BYLINE_AI_PROVIDER=off .venv/Scripts/python -m uvicorn byline.api.app:app --port 8000
//   (web)      npm run build && npx vite preview --port 4173
//   node scripts/t009-screenshots.mjs [--url http://127.0.0.1:4173] [--only desktop|tablet|mobile]
//
// Drives the real UI: speed 30x, scrub to 25:00, play until the 27'-28'
// story arrives, open Show evidence, then capture. Also captures three
// theatre frames 200 ms apart at 1x to check that players move smoothly.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const BASE = arg('--url') ?? 'http://127.0.0.1:4173'
const ONLY = arg('--only')
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
].filter((v) => !ONLY || v.name === ONLY)

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
let failures = 0

async function waitTheatreReady(page) {
  await page.waitForSelector('.mt[data-loading="false"]', { timeout: 20_000 })
}

async function scrubTo(page, seconds) {
  const slider = page.getByRole('slider', { name: 'Replay position' })
  await slider.fill(String(seconds))
  await page.waitForTimeout(600)
}

async function clockText(page) {
  return page.evaluate(() => document.querySelector('.replay__elapsed')?.textContent ?? '')
}

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const errors = []
    const consoleWarnings = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' || m.text().includes('[byline]')) consoleWarnings.push(m.text())
    })

    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts.ready)
    await waitTheatreReady(page)
    await page.waitForTimeout(800)
    await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-kickoff.png`) })

    // --- frame sequence at 1x: players should move a little, smoothly.
    if (vp.name === 'desktop') {
      await page.getByRole('radio', { name: '1 times speed' }).click()
      await scrubTo(page, 600)
      await page.getByRole('button', { name: 'Play replay' }).click()
      await page.waitForTimeout(1500)
      // Capture the canvas in-page so the 200 ms spacing is real (no screenshot latency).
      const shots = await page.evaluate(async () => {
        const canvas = document.querySelector('.mt__canvas')
        const grabbed = []
        const t0 = performance.now()
        for (let i = 0; i < 3; i += 1) {
          // Wait until the scheduled instant, then snapshot the next painted frame.
          while (performance.now() - t0 < i * 200) await new Promise((r) => requestAnimationFrame(r))
          grabbed.push({
            at: Math.round(performance.now() - t0),
            clock: document.querySelector('.replay__elapsed')?.textContent ?? '',
            bmp: await createImageBitmap(canvas),
          })
        }
        const c = document.createElement('canvas')
        return grabbed.map((g) => {
          c.width = g.bmp.width
          c.height = g.bmp.height
          c.getContext('2d').drawImage(g.bmp, 0, 0)
          return { at: g.at, clock: g.clock, url: c.toDataURL('image/png') }
        })
      })
      for (const [i, s] of shots.entries()) {
        await writeFile(resolve(OUT, `t009-frames-${i + 1}.png`), Buffer.from(s.url.split(',')[1], 'base64'))
        console.log(`frame ${i + 1}: t=${s.at} ms, replay ${s.clock}`)
      }
      await page.getByRole('button', { name: 'Pause replay' }).click()
    }

    // --- jump near the 28' channel story and play at 30x.
    await page.getByRole('radio', { name: '30 times speed' }).click()
    await scrubTo(page, 1500)
    const playing = await page.getByRole('button', { name: 'Pause replay' }).count()
    if (!playing) await page.getByRole('button', { name: 'Play replay' }).click()
    const deadline = Date.now() + 20_000
    let cardSeen = false
    while (Date.now() < deadline) {
      await page.waitForTimeout(500)
      const n = await page.locator('.story, .companion__state').count()
      const t = await clockText(page)
      if (n > 0 && t >= '27:20') {
        cardSeen = true
        break
      }
    }
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Pause replay' }).click().catch(() => {})
    await page.waitForTimeout(500)
    console.log(`${vp.name}: replay clock ${await clockText(page)} | story visible ${cardSeen}`)
    await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-story.png`) })

    // --- open evidence
    if (vp.name === 'desktop') {
      await page.getByRole('button', { name: 'Show why' }).first().click()
    } else if (vp.name === 'tablet') {
      await page.getByRole('button', { name: 'Open match centre' }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-radar.png`) })
      await page.getByRole('button', { name: 'Show why' }).first().click()
    } else {
      await page.getByRole('button', { name: /^Stories/ }).click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-radar.png`) })
      await page.getByRole('button', { name: 'Show why' }).first().click()
    }
    await page.waitForSelector('.evidence__events', { timeout: 10_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-evidence.png`) })
    if (vp.name === 'mobile') {
      await page.getByRole('button', { name: 'View on pitch' }).click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: resolve(OUT, `t009-${vp.name}-evidence-pitch.png`) })
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    console.log(`${vp.name}: horizontal overflow ${overflow}px | page errors ${errors.length} | console ${consoleWarnings.length}`)
    for (const e of [...errors, ...consoleWarnings]) console.log(`  ${e}`)
    if (overflow > 0 || errors.length || !cardSeen) failures += 1
    await context.close()
  }
} finally {
  await browser.close()
}
process.exitCode = failures ? 1 : 0
