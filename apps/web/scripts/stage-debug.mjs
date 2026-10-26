// Dev helper: open one harness URL, print console output, save a screenshot. Not part of the build.
//   node scripts/stage-debug.mjs "<query>" <out.png> [width] [height] [waitMs]
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const [query = 'moment=T-option-NBA-0180', out = 'stage-debug.png', w = '1440', h = '900', wait = '1500', action = ''] = process.argv.slice(2)
// STAGE_GPU=1 uses the machine's GPU (D3D11 via ANGLE) for realistic frame timing; default is SwiftShader
const gpu = process.env.STAGE_GPU === '1'
// STAGE_NOGL=1 disables WebGL to exercise the SVG fallback
const nogl = process.env.STAGE_NOGL === '1'
const browser = await chromium.launch({
  args: nogl ? ['--disable-webgl', '--disable-3d-apis'] : gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
// STAGE_REDUCED=1 emulates prefers-reduced-motion
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, reducedMotion: process.env.STAGE_REDUCED === '1' ? 'reduce' : 'no-preference' })
await page.route('**/@fs/**/*.woff2', async (route) => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/@fs\//, ''))
  try {
    await route.fulfill({ body: await readFile(path), contentType: path.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' })
  } catch {
    await route.continue()
  }
})
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`http://localhost:5199/stage.html?${query}`)
await page.waitForFunction(() => window.__stage?.ready === true || !!window.__stage?.error, null, { timeout: 30000 }).catch(() => console.log('not ready'))
if (action === 'replay') {
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: /Replay the real play/ }).click()
} else if (action === 'next') {
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Next step' }).click()
} else if (action === 'tour') {
  // every step transition in turn, then the replay: frame intervals are collected while animating
  await page.waitForTimeout(800)
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('button', { name: 'Next step' }).click()
    await page.waitForTimeout(3600)
  }
  await page.getByRole('button', { name: /Replay the real play/ }).click()
}
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
})
console.log('webgl renderer:', renderer)
await page.waitForTimeout(Number(wait))
const stats = await page.evaluate(() => window.__stage?.handle?.stats?.() ?? null)
if (stats) console.log('stats', JSON.stringify(stats))
await page.screenshot({ path: out, fullPage: true })
await browser.close()
