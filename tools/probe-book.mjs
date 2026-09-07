/**
 * End-to-end check of the projects journal's contents page.
 *
 * Opens the projects tent, clicks a title on the contents page, and reports
 * which leaf the journal turned to. The entries are painted into the page
 * texture, so there is nothing in the DOM to click — it has to be a real click
 * on the canvas, and the answer has to come back out through the dev-only
 * `window.__bookSpread` that Book.tsx publishes.
 *
 *   node tools/probe-book.mjs
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

/**
 * Contents entries, as fractions of the frame.
 *
 * Taken off a capture of the contents spread. They move if the page layout
 * changes, which is the point — a probe that cannot miss is not testing much.
 */
const TARGETS = [
  { label: 'Realistic Hajwala (games, first)', x: 0.330, y: 0.330, expect: 1 },
  // Eighteen, not fifteen: the ledger has grown three entries since these
  // coordinates were last struck, and the probe had been failing on both
  // counts — a stale target and a stale answer.
  { label: 'Build Pipeline (tools, last)', x: 0.562, y: 0.425, expect: 18 },
]

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
  for (const t of TARGETS) {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 1 })

    const problems = []
    page.on('pageerror', (e) => {
      const stack = (e.stack ?? '').split('\n').slice(0, 14).join(' | ')
      problems.push(stack || e.message)
    })

    await page.goto('http://localhost:5175/?room=2&travel=1&book=1&reveal=1', {
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

    const x = Math.round(width * t.x)
    const y = Math.round(height * t.y)
    await page.mouse.move(x, y)
    await new Promise((r) => setTimeout(r, 350))
    await page.mouse.click(x, y)

    // The turn is an animation; the spread only changes when the sheet lands.
    await new Promise((r) => setTimeout(r, 2200))

    const spread = await page.evaluate(() => window.__bookSpread ?? null)
    const ok = spread === t.expect
    if (!ok) failures++

    console.log(
      `${ok ? 'ok  ' : 'FAIL'}  ${t.label}  click ${x},${y}  ->  spread ${spread} (expected ${t.expect})`
    )
    if (problems.length) console.log('      errors: ' + problems[0])

    mkdirSync(resolve('tools/shots'), { recursive: true })
    await page.screenshot({ path: resolve(`tools/shots/probe-book-${t.expect}.png`) })
    await page.close()
  }
} finally {
  await browser.close()
}

process.exitCode = failures === 0 ? 0 : 1
