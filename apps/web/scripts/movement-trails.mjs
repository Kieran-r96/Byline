// Motion-trail composite of the live theatre at 1x (Full pitch camera) for the P1 demonstration.
//   node scripts/movement-trails.mjs [--url http://localhost:4173]   (backend at 127.0.0.1:8000)
import { chromium } from '@playwright/test'

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(url)
await page.locator('.mt[data-loading="false"]').waitFor()
await page.getByRole('button', { name: 'Full pitch' }).click()
await page.getByRole('slider', { name: 'Replay position' }).fill('1625')
await page.waitForTimeout(800)
await page.getByRole('radio', { name: '4 times speed' }).click()
const play = page.getByRole('button', { name: 'Play replay' })
if (await play.isVisible()) await play.click()
await page.waitForTimeout(1200)
const canvas = page.locator('.mt canvas')
const shots = []
for (let i = 0; i < 8; i += 1) {
  shots.push((await canvas.screenshot()).toString('base64'))
  await page.waitForTimeout(500)
}
// composite in the page: lighten-blend the frames, latest frame on top at full opacity
const out = await page.evaluate(async (frames) => {
  const imgs = await Promise.all(frames.map((b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = `data:image/png;base64,${b64}` })))
  const c = document.createElement('canvas')
  c.width = imgs[0].width; c.height = imgs[0].height
  const ctx = c.getContext('2d')
  ctx.drawImage(imgs[0], 0, 0)
  ctx.globalCompositeOperation = 'lighten'
  imgs.forEach((im, i) => { ctx.globalAlpha = 0.35 + (0.65 * i) / (imgs.length - 1); ctx.drawImage(im, 0, 0) })
  return c.toDataURL('image/jpeg', 0.88).split(',')[1]
}, shots)
const fs = await import('node:fs')
fs.mkdirSync('screenshots', { recursive: true })
fs.writeFileSync('screenshots/p1-movement-trails.jpg', Buffer.from(out, 'base64'))
console.log('wrote screenshots/p1-movement-trails.jpg (8 frames over 3.5 s at 4x, Full pitch camera)')
await browser.close()
