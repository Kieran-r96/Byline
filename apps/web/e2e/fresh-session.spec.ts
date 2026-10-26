/**
 * A judge's first visit: a brand-new browser context (no cookies, no storage, no credentials) against the
 * built app and a cache-only backend. Asserts the app loads and plays, a recorded verified Foundry story is
 * reachable, nothing is requested from any other host (no Azure, no font CDN, no analytics), no request is
 * refused for lack of credentials, and the console stays free of errors and CSP violations.
 *
 * Default target: the Playwright `vite preview` server. Set FRESH_SESSION_URL to point it at the
 * single-container build (FastAPI serving apps/web/dist), which also checks the security headers:
 *
 *   cd apps/api && BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true BYLINE_STATIC_DIR=../web/dist \
 *     .venv/Scripts/python -m uvicorn byline.api.app:app --port 8000
 *   cd apps/web && FRESH_SESSION_URL=http://127.0.0.1:8000 npx playwright test fresh-session
 */
import { expect, test } from '@playwright/test'
import { openHistory, position, scrubTo } from './helpers'

const TARGET = process.env.FRESH_SESSION_URL

test('fresh browser session: loads, plays, same-origin only, no credentials, no console errors', async ({ browser, baseURL }) => {
  const base = new URL(TARGET ?? baseURL ?? 'http://127.0.0.1:4174')
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  await context.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  const page = await context.newPage()

  const foreign: string[] = []
  const refused: string[] = []
  const consoleErrors: string[] = []
  page.on('request', (req) => {
    const u = new URL(req.url())
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.host !== base.host) foreign.push(req.url())
  })
  page.on('response', (res) => {
    if (res.status() === 401 || res.status() === 403) refused.push(`${res.status()} ${res.url()}`)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  const doc = await page.goto(base.href)
  expect(doc?.status()).toBe(200)
  if (TARGET) {
    // single-container build: the API also serves the app shell with the security headers
    const h = doc!.headers()
    expect(h['content-security-policy']).toContain("script-src 'self'")
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('no-referrer')
  }

  // loads and plays
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled({ timeout: 20_000 })
  await expect(page.locator('.sp__player').first()).toBeVisible({ timeout: 20_000 })
  const before = await position(page)
  await page.getByRole('button', { name: 'Play replay' }).click()
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible()
  await expect.poll(() => position(page), { timeout: 15_000 }).toBeGreaterThan(before)

  // the recorded real Foundry story is served to an anonymous visitor (cache-only: no new model call)
  await scrubTo(page, 1700)
  await openHistory(page, 'Developing')
  await expect(page.locator('.dev[data-kind="ai-story"]').filter({ hasText: /right channel/i }).first())
    .toContainText('verified by Foundry agents')

  const status = await page.evaluate(async () => (await fetch('/api/system/status')).json())
  expect(status.ai.cache_only).toBe(true)
  expect(status.ai.state).toBe('recorded')

  const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
  expect(csp, 'CSP violations').toEqual([])
  expect(foreign, 'requests to other hosts').toEqual([])
  expect(refused, 'requests refused for lack of credentials').toEqual([])
  expect(consoleErrors, 'console errors').toEqual([])
  expect(await context.cookies(), 'the app sets no cookies').toEqual([])
  await context.close()
})
