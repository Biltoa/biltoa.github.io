/**
 * What the pages look like while the journal is shutting.
 *
 * The ink used to drain off the paper the moment the reader left, so the cover
 * came down over two blank sheets. Nothing about that is visible from either
 * end of the animation, which is why it needs a capture mid-close: three
 * frames across the half-second after Escape.
 *
 *   node tools/probe-close.mjs
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await page.goto('http://localhost:5173/?room=0', {
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
  await wait(11000)
  await page.mouse.click(Math.round(width * 0.5), Math.round(height * 0.55))
  await wait(4000)

  mkdirSync(resolve('tools/shots'), { recursive: true })
  await page.screenshot({ path: resolve('tools/shots/close-0-open.png') })

  await page.keyboard.press('Escape')
  for (const ms of [200, 380, 560]) {
    await wait(ms === 200 ? 200 : 180)
    await page.screenshot({ path: resolve(`tools/shots/close-${ms}.png`) })
    console.log(`shot   ${ms}ms after Escape`)
  }
  await page.close()
} finally {
  await browser.close()
}
