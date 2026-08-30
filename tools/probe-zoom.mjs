/**
 * End-to-end check of pressing a picture in the projects journal.
 *
 * Turns to a tool chapter, presses the printed plate, and reports whether the
 * enlargement opened, what it is showing, and that it grew from the plate's own
 * footprint rather than from nowhere. Then presses Escape and checks the reader
 * is put back on the page rather than out of the tent.
 *
 *   node tools/probe-zoom.mjs
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean).find((p) => existsSync(p))

if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.')

const width = 1280
const height = 720

/** Centre of the printed plate on a tool chapter's right-hand page. */
const PLATE = { x: 0.645, y: 0.33 }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-extensions',
    `--window-size=${width},${height}`,
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })

  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))

  // Opened straight onto a tool chapter, so the plate is where it is expected.
  await page.goto('http://localhost:5173/?room=2&travel=1&book=1&reveal=1&spread=9', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas')
      return !!c && c.width > 32
    },
    { timeout: 60_000 }
  )
  await new Promise((r) => setTimeout(r, 9000))

  const x = Math.round(width * PLATE.x)
  const y = Math.round(height * PLATE.y)
  await page.mouse.move(x, y)
  await new Promise((r) => setTimeout(r, 350))
  await page.mouse.click(x, y)

  await new Promise((r) => setTimeout(r, 260))
  const start = await page.evaluate(() => {
    const el = document.querySelector('.bookzoom')
    const f = document.querySelector('.bookzoom__frame')
    if (!el || !f) return null
    const r = f.getBoundingClientRect()
    return {
      phase: el.getAttribute('data-phase'),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    }
  })

  await new Promise((r) => setTimeout(r, 1200))
  const open = await page.evaluate(() => {
    const el = document.querySelector('.bookzoom')
    const img = document.querySelector('.bookzoom__frame img')
    if (!el || !img) return { opened: false }
    const r = img.getBoundingClientRect()
    return {
      opened: true,
      phase: el.getAttribute('data-phase'),
      src: img.getAttribute('src'),
      // The uncropped capture, not the printed crop.
      full: img.naturalWidth + 'x' + img.naturalHeight,
      onScreen: [Math.round(r.width), Math.round(r.height)],
    }
  })

  mkdirSync(resolve('tools/shots'), { recursive: true })
  await page.screenshot({ path: resolve('tools/shots/probe-zoom.png') })

  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 1000))
  const after = await page.evaluate(() => ({
    zoomGone: !document.querySelector('.bookzoom'),
    stillInTent: document.querySelector('.doorback')?.getAttribute('data-hidden') === 'false',
  }))

  console.log(`click  ${x},${y}`)
  console.log(`start  ${JSON.stringify(start)}`)
  console.log(`open   ${JSON.stringify(open)}`)
  console.log(`escape ${JSON.stringify(after)}`)
  if (problems.length) console.log('errors ' + problems[0])
  console.log('shot   tools/shots/probe-zoom.png')
} finally {
  await browser.close()
}
