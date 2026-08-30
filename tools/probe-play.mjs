/**
 * End-to-end check of the journal → build transition.
 *
 * Walks into the gameplay tent, clicks the "Play it here" link painted on the
 * page, and reports whether the player opened and out of which rectangle. The
 * click has to be a real one on the canvas — the link is a mesh on a page in a
 * 3D scene, so there is nothing in the DOM to query for it and nothing to call
 * directly.
 *
 *   node tools/probe-play.mjs            # 1280x720
 *   node tools/probe-play.mjs 1600 900
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

const width = Number(process.argv[2] ?? 1280)
const height = Number(process.argv[3] ?? 720)

/**
 * Centre of the printed gameplay plate on the right-hand page.
 *
 * The picture is the button now: the chapter used to carry a "Play it here"
 * link under a list of facts, and the reader had to read a page to find out
 * they could press the picture.
 */
const LINK = { x: 0.644, y: 0.328 }

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
  page.on('pageerror', (e) => {
    const stack = (e.stack ?? '').split('\n').slice(0, 16).join('\n')
    problems.push(`${e.message}\n${stack}`)
  })

  // The reported bug was the engine still being audible after the build was put
  // away, so the check has to be about audio hardware rather than about the DOM.
  // Every context the page opens is recorded here, before any page code runs.
  await page.evaluateOnNewDocument(() => {
    const Native = window.AudioContext
    window.__ctxs = []
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args)
        window.__ctxs.push(this)
      }
    }
  })

  await page.goto(`http://localhost:5173/?room=1&travel=1&book=1&reveal=1`, {
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

  // The links only arm once the camera has arrived and the ink has finished
  // arriving, which is a few seconds after the canvas is live.
  await new Promise((r) => setTimeout(r, 9000))

  const x = Math.round(width * LINK.x)
  const y = Math.round(height * LINK.y)

  // Move first: the mark under the cursor has to take a pointerover before it
  // will take a click, the same as it does for a real reader.
  await page.mouse.move(x, y)
  await new Promise((r) => setTimeout(r, 350))
  await page.mouse.click(x, y)

  // Sampled before the transition has run, so the rectangle it starts from can
  // be checked against the page rather than assumed.
  await new Promise((r) => setTimeout(r, 260))
  const start = await page.evaluate(() => {
    const el = document.querySelector('.bookplayer')
    const f = document.querySelector('.bookplayer__frame')
    if (!f || !el) return null
    const r = f.getBoundingClientRect()
    return {
      phase: el.getAttribute('data-phase'),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    }
  })

  await new Promise((r) => setTimeout(r, 1400))

  const result = await page.evaluate(() => {
    const el = document.querySelector('.bookplayer')
    const frame = document.querySelector('.bookplayer__frame')
    const veil = document.querySelector('.bookplayer__veil')
    if (!el || !frame) return { opened: false }
    const r = frame.getBoundingClientRect()
    return {
      opened: true,
      phase: el.getAttribute('data-phase'),
      frame: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      status: veil ? veil.innerText.split('\n')[0] : 'ready',
    }
  })

  mkdirSync(resolve('tools/shots'), { recursive: true })
  await page.screenshot({ path: resolve('tools/shots/probe-play.png') })

  // Escape belongs to the player while it is up. It should put the build away
  // and leave the reader in the tent, not walk them out of it.
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 1200))
  const afterEscape = await page.evaluate(() => ({
    playerGone: !document.querySelector('.bookplayer'),
    stillInTent: document.querySelector('.doorback')?.getAttribute('data-hidden') === 'false',
    // A context left 'running' after the build is gone is the engine still
    // playing to nobody.
    contexts: (window.__ctxs ?? []).map((c) => c.state),
  }))

  console.log(`click  ${x},${y}`)
  console.log(`start  ${JSON.stringify(start)}`)
  console.log(`result ${JSON.stringify(result)}`)
  console.log(`escape ${JSON.stringify(afterEscape)}`)
  if (problems.length) console.log('errors\n' + problems.slice(0, 1).join('\n'))
  console.log('shot   tools/shots/probe-play.png')
} finally {
  await browser.close()
}
