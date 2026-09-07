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
  // Aim at the left canvas flap of each A-frame. The doorway itself is an
  // intentional hole and is therefore not a raycast target.
  { i: 0, x: 240, y: 475 },
  { i: 1, x: 740, y: 475 },
  { i: 2, x: 1230, y: 475 },
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
    await new Promise((r) => setTimeout(r, 1200))
    const beforeCue = await page.evaluate(() => {
      let outlined = 0
      window.__camp.scene.traverse((object) => {
        if (object.isMesh && object.layers.isEnabled(10)) outlined++
      })
      return { travel: window.__cam?.travel, outlined, outline: window.__campOutline }
    })
    await new Promise((r) => setTimeout(r, 450))
    const afterCue = await page.evaluate(() => {
      let outlined = 0
      window.__camp.scene.traverse((object) => {
        if (object.isMesh && object.layers.isEnabled(10)) outlined++
      })
      return { travel: window.__cam?.travel, outlined, outline: window.__campOutline }
    })
    await new Promise((r) => setTimeout(r, 4350))
    const state = await page.evaluate(() => ({
      cam: window.__cam,
      spreads: window.__bookSpreads,
      outlined: (() => {
        let count = 0
        window.__camp.scene.traverse((object) => {
          if (object.isMesh && object.layers.isEnabled(10)) count++
        })
        return count
      })(),
      outline: window.__campOutline,
    }))
    const arrivedAt = state.cam?.idx
    let stationaryExit = null
    if (t.i === 0) {
      // Exact regression: the pointer never leaves the tent coordinate. Exit
      // by keyboard, wait for the camera and hover guard, then verify the tent
      // adopts that stationary pointer without a synthetic mouse movement.
      await page.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 6_500))
      stationaryExit = await page.evaluate((index) => {
        let outlined = 0
        window.__camp.scene.traverse((object) => {
          if (object.isMesh && object.layers.isEnabled(10)) outlined++
        })
        return {
          travel: window.__cam?.travel,
          outlined,
          scale: window.__tentHover?.[index]?.scale ?? 1,
        }
      }, t.i)
    }
    const ok =
      arrivedAt === t.i &&
      beforeCue.outline?.desired === null &&
      afterCue.outline?.desired?.kind === 'book' &&
      afterCue.outline?.desired?.index === t.i &&
      state.outline?.desired?.kind === 'book' &&
      state.outline?.desired?.index === t.i &&
      (stationaryExit === null ||
        (stationaryExit.travel < 0.02 &&
          stationaryExit.outlined === 1 &&
          stationaryExit.scale > 1.02))
    if (!ok) failures++
    console.log(
      `tent ${t.i}: camera at ${arrivedAt}, outline ${beforeCue.outlined}→${afterCue.outlined}→${state.outlined}` +
        (stationaryExit
          ? `, stationary exit outline ${stationaryExit.outlined}, scale ${stationaryExit.scale.toFixed(3)}`
          : '') +
        ` ${ok ? 'OK' : 'FAIL'}` +
        (problems.length ? `  problems: ${problems.slice(0, 2).join(' | ')}` : '')
    )
    if (problems.length) failures++
    await page.close()
  }
} finally {
  await browser.close()
}
process.exit(failures ? 1 : 0)
