/**
 * Headless screenshots of the flat pages — /projects and a project's page.
 *
 *   node tools/shot-flat.mjs projects /projects
 *   node tools/shot-flat.mjs amer /projects/amer-fighting 1440x1600 full
 *   node tools/shot-flat.mjs scrolled /projects 1440x1200 - 900   # scrolled down
 *
 * `shot.mjs` is the campsite's shutter: it blocks on a `<canvas>` appearing and
 * on the scene reporting itself ready, because a screenshot of that page taken
 * any earlier is a grey frame. The written-out pages have no canvas on them, so
 * that wait never returns — this is the same shutter without it, waiting on the
 * network settling and the web fonts landing instead.
 *
 * Writes `tools/shots/<name>.png` and prints anything the page logged as an
 * error, which is how a broken import shows up as something other than a blank
 * picture.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.')

const [name, path = '/', size = '1440x1200', full = '', scroll = '0'] = process.argv.slice(2)
if (!name) throw new Error('usage: node tools/shot-flat.mjs <name> <path> [WxH] [full]')

const port = process.env.PORT ?? 5173
const url = path.startsWith('http') ? path : `http://localhost:${port}${path}`
const [w, h] = size.split('x').map(Number)

const out = resolve('tools/shots')
mkdirSync(out, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--force-device-scale-factor=1'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })

  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push(String(e)))

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  // The page is set in a web font and lays out differently in the fallback;
  // shooting before the face lands compares two different documents.
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 900))

  // Sticky furniture only misbehaves once the page has moved under it.
  if (Number(scroll) > 0) {
    await page.evaluate((y) => window.scrollTo(0, y), Number(scroll))
    await new Promise((r) => setTimeout(r, 400))
  }

  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full === 'full' })
  if (errs.length) console.log(`errors:\n${errs.join('\n')}`)
  console.log(`${out}/${name}.png`)
} finally {
  await browser.close()
}
