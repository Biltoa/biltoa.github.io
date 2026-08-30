/**
 * Clicks each tent in the 3D scene and checks the camera actually walks into
 * it. Guards the raycast against composition changes: moving, turning or
 * rescaling a tent is exactly the kind of edit that silently breaks the hit
 * test, and nothing else in the harness would notice.
 *
 *   node tools/qa/click-tents.mjs [port]
 *
 * Reads the dev-only `window.__cam` handle CameraRig publishes.
 */
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.')

const port = process.argv[2] ?? '5174'
const W = 1600
const H = 900

/** Where each tent's fabric sits on screen at 1600x900, from a capture. */
const TARGETS = [
  { i: 0, x: 300, y: 480 },
  { i: 1, x: 800, y: 470 },
  { i: 2, x: 1300, y: 480 },
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage', '--no-first-run', `--window-size=${W},${H}`],
})

let failures = 0
try {
  for (const t of TARGETS) {
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
    const problems = []
    page.on('pageerror', (e) => problems.push(e.message))
    page.on('console', (m) => {
      const s = m.text()
      if (m.type() === 'error' && !s.includes('glGetProgramiv')) problems.push(s)
    })
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas')
    await new Promise((r) => setTimeout(r, 9000))
    await page.mouse.move(t.x, t.y)
    await new Promise((r) => setTimeout(r, 400))
    await page.mouse.click(t.x, t.y)
    await new Promise((r) => setTimeout(r, 6000))
    const state = await page.evaluate(() => ({
      cam: window.__cam,
      spreads: window.__bookSpreads,
    }))
    const arrivedAt = state.cam?.idx
    const ok = arrivedAt === t.i
    if (!ok) failures++
    console.log(
      `tent ${t.i}: camera at ${arrivedAt} ${ok ? 'OK' : 'FAIL'}` +
        (problems.length ? `  problems: ${problems.slice(0, 2).join(' | ')}` : '')
    )
    if (problems.length) failures++
    await page.close()
  }
} finally {
  await browser.close()
}
process.exit(failures ? 1 : 0)
