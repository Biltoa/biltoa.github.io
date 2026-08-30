/**
 * Does a journal that has been put down open on its first leaf again?
 *
 * Walks into the projects tent, opens the book, jumps to a chapter off the
 * contents page, then leaves by Escape and waits for the camera to come back
 * out to the fire. The reset is hung off the tent's interior going dark, which
 * is a frame or two after the cover has finished shutting, so the check has to
 * wait for the walk-out rather than for the keypress.
 *
 *   node tools/probe-reopen.mjs
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

let failures = 0

try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))

  // No ?travel= here on purpose: the freeze that makes the spread easy to
  // screenshot also pins the walk-out, and the walk-out is the thing under
  // test.
  await page.goto('http://localhost:5173/?room=2', {
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

  // The closed cover, then a chapter off the contents page.
  await page.mouse.click(Math.round(width * 0.5), Math.round(height * 0.55))
  await wait(3500)
  await page.mouse.move(Math.round(width * 0.582), Math.round(height * 0.465))
  await wait(350)
  await page.mouse.click(Math.round(width * 0.582), Math.round(height * 0.465))
  await wait(2600)

  const turned = await page.evaluate(() => window.__bookSpread ?? null)
  console.log(`     turned to spread ${turned}`)
  if (!turned) {
    failures++
    console.log('FAIL the contents jump did not land — the rest of this probe means nothing')
  }

  mkdirSync(resolve('tools/shots'), { recursive: true })
  await page.screenshot({ path: resolve('tools/shots/probe-reopen-turned.png') })

  await page.keyboard.press('Escape')
  await wait(6000)

  const after = await page.evaluate(() => window.__bookSpreads?.[2] ?? null)
  const ok = after === 0
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} after leaving the tent: spread ${after} (expected 0)`)
  if (problems.length) console.log('      errors: ' + problems[0])

  await page.screenshot({ path: resolve('tools/shots/probe-reopen-left.png') })
  await page.close()
} finally {
  await browser.close()
}

process.exitCode = failures === 0 ? 0 : 1
