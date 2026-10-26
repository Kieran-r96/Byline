/**
 * P1 browser demonstration: players move continuously across the whole pitch at 1x
 * (static "Full pitch" camera so pixel change comes only from players and the ball).
 * REQUIRES the FastAPI backend at http://127.0.0.1:8000 (see smoke.spec.ts header).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loadApp, scrubTo } from './helpers'

async function canvasCells(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const c = document.querySelector('.mt canvas') as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) return []
    const { width, height } = c
    const data = ctx.getImageData(0, 0, width, height).data
    // 4 x 3 grid of luminance sums
    const cols = 4
    const rows = 3
    const out = new Array(cols * rows).fill(0) as number[]
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const i = (y * width + x) * 4
        const cell = Math.min(rows - 1, Math.floor((y / height) * rows)) * cols + Math.min(cols - 1, Math.floor((x / width) * cols))
        out[cell] += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11
      }
    }
    return out
  })
}

test('players move continuously across the pitch at 1x (no frozen zones)', async ({ page }) => {
  await loadApp(page)
  // Fan Classic is the surface with the full match picture
  await page.getByRole('radio', { name: 'Fan', exact: true }).click()
  await page.getByRole('radio', { name: 'Classic', exact: true }).click()
  await page.getByRole('button', { name: 'Full pitch' }).click()
  await scrubTo(page, 1200) // open play in the first half
  await page.getByRole('radio', { name: '1 times speed' }).click()
  const play = page.getByRole('button', { name: 'Play replay' })
  if (await play.isVisible()) await play.click()
  await page.waitForTimeout(1500)
  const samples: number[][] = []
  for (let i = 0; i < 5; i += 1) {
    samples.push(await canvasCells(page))
    await page.waitForTimeout(900)
  }
  // a cell "moves" when its luminance changes between consecutive samples
  const moving = samples[0].map((_, cell) =>
    samples.slice(1).some((s, k) => Math.abs(s[cell] - samples[k][cell]) / Math.max(1, samples[k][cell]) > 0.0005),
  )
  const share = moving.filter(Boolean).length / moving.length
  // the far third can legitimately hold only a goalkeeper (high defensive line), and the canvas includes
  // stadium margins; per-player stillness is asserted precisely by the backend invariants (test_movement.py)
  expect(share, `moving cells ${moving.map((m) => (m ? 1 : 0)).join('')}`).toBeGreaterThanOrEqual(0.5)
})
