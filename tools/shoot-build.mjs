/**
 * Screenshots the Unity WebGL build actually running in a browser.
 *
 * The journal's gameplay chapter is about this build, so the pictures on it
 * should be of this build rather than of the editor that produced it. Unity's
 * own capture tools were the obvious route and were not usable: the Game view
 * capture enters Play mode and returns the first frame, which is a fade, and
 * the Scene view returns wherever the editor camera happens to be pointing.
 *
 * Loads the player, waits for it to finish streaming, then grabs a frame every
 * few seconds so there is something to choose between.
 *
 *   node tools/shoot-build.mjs              # 4 frames, 6s apart
 *   node tools/shoot-build.mjs 6 4000
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

/**
 * Headless Chrome will load and render the build perfectly and then swallow
 * every synthesised click and keypress before Unity sees it, so the capture
 * comes back as a screenshot of the game's own intro card. Driving the build
 * needs a real window.
 */
const headful = process.argv.includes('--headful')

const frames = Number(process.argv[2] ?? 4)
const gap = Number(process.argv[3] ?? 6000)
if (Number.isNaN(frames) || Number.isNaN(gap)) throw new Error('frames and gap must be numbers')

const OUT = resolve('public/media/build')
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !headful,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-extensions',
    // The build is a quarter of a gigabyte; the default headless disk cache is
    // far too small to hold it between runs.
    '--disk-cache-size=1073741824',
    '--window-size=1280,720',
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log(`pageerror ${e.message}`))

  // Headless Chrome reports the page as unfocused, and Unity WebGL gates its
  // input handling on that — every synthesised click and key was being
  // delivered to a canvas that believed nobody was looking at it.
  // Every AudioContext the page opens is recorded before any page code runs, so
  // the teardown can be checked against the audio hardware rather than against
  // the DOM. The reported bug was the engine still being audible after the
  // build had been put away.
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

  await page.bringToFront()
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  // The build only plays inside the journal now: the standalone player page is
  // gone, because a second place showing the same thing was a fork in the road
  // with nothing at the end of it.
  await page.goto('http://localhost:5173/?room=1&travel=1&book=1&reveal=1', {
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
  // The printed plate is only pressable once the camera has arrived and the ink
  // has finished landing.
  await new Promise((r) => setTimeout(r, 9000))

  // Same point tools/probe-play.mjs presses, at the same frame size.
  const px = Math.round(1280 * 0.644)
  const py = Math.round(720 * 0.328)
  await page.mouse.move(px, py)
  await new Promise((r) => setTimeout(r, 350))
  await page.mouse.click(px, py)
  await new Promise((r) => setTimeout(r, 1500))

  const opened = await page.evaluate(() => !!document.querySelector('.bookplayer'))
  console.log(`launched ${px},${py} opened=${opened}`)
  if (!opened) throw new Error('pressing the plate did not open the player')

  await page.waitForFunction(() => !document.querySelector('.bookplayer__veil'), {
    timeout: 900_000,
    polling: 2000,
  }).catch(() => console.log('veil never cleared, grabbing anyway'))

  console.log('state  ready')

  /**
   * Grabs the player's canvas, re-querying it every time.
   *
   * The element handle cannot be held on to: React swaps the node as the
   * transition finishes, and a screenshot through a stale handle fails with
   * "Node is detached from document" several minutes into a run.
   */
  const shoot = async (out) => {
    const el = await page.$('.bookplayer__frame canvas')
    if (!el) throw new Error('no unity canvas')
    await el.screenshot({ path: out })
  }

  // An element screenshot captures the page region under that element, which
  // includes anything drawn on top of it. Without this every frame comes back
  // with the player's own controls bar and the dev FPS badge printed across the
  // game — and those then end up on a page of the journal.
  await page.addStyleTag({
    content: `
      .bookplayer__controls,
      .campui,
      .fpsmeter,
      .doorback,
      .tolong,
      .tentswitch { visibility: hidden !important; }
    `,
  })

  const box = await page.evaluate(() => {
    const c = document.querySelector('.bookplayer__frame canvas')
    const r = c.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  if (!box.width) throw new Error('canvas has no box')

  console.log(`canvas ${Math.round(box.width)}x${Math.round(box.height)}`)

  /**
   * Clicks a point given as a fraction of the canvas.
   *
   * Moved-then-pressed rather than `mouse.click`: Unity's UI raycaster wants a
   * pointer-enter on the button before it will accept the press, and a
   * synthesised click that arrives with no movement in front of it lands on a
   * button that never entered its hover state.
   */
  const clickAt = async (fx, fy) => {
    const x = box.x + box.width * fx
    const y = box.y + box.height * fy
    await page.mouse.move(x, y)
    await new Promise((r) => setTimeout(r, 300))
    await page.mouse.down()
    await new Promise((r) => setTimeout(r, 120))
    await page.mouse.up()
  }

  // The build opens on its own controls card. Dismiss it, or every frame is a
  // screenshot of a menu.
  await new Promise((r) => setTimeout(r, 4000))
  await clickAt(0.5, 0.8)
  await clickAt(0.74, 0.229)
  await new Promise((r) => setTimeout(r, 700))
  // Belt and braces: some builds close their intro card on a key instead.
  // Escape is deliberately not in this list any more — the journal's player
  // takes Escape as "put the build away", so pressing it here closed the very
  // thing being captured.
  for (const k of ['Enter', 'Space', 'KeyX']) {
    await page.keyboard.press(k)
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 900))
  await shoot(resolve(OUT, 'after-dismiss.png'))

  // Focus the canvas so it takes the keys, then drive. A parked car is a
  // screenshot of a car park.
  await page.evaluate(() => document.querySelector('#unity-canvas')?.focus())
  await clickAt(0.5, 0.8)
  await page.keyboard.down('w')

  for (let i = 1; i <= frames; i++) {
    // Steer into and out of a slide across the run, so the frames differ.
    // A short dab of steering rather than half the interval on the stick. Held
    // that long the car simply drove into the barrier, and a screenshot of a
    // stationary car against a fence is not a screenshot of a driving game.
    const turn = i % 2 === 0 ? 'd' : 'a'
    await page.keyboard.down(turn)
    await new Promise((r) => setTimeout(r, 260))
    await page.keyboard.up(turn)
    await new Promise((r) => setTimeout(r, gap - 260))

    const out = resolve(OUT, `frame-${String(i).padStart(2, '0')}.png`)
    await shoot(out)
    console.log(`frame  ${i}/${frames}  ->  ${out}`)
  }

  await page.keyboard.up('w')

  // Put the build away and check nothing is still playing.
  const before = await page.evaluate(() => (window.__ctxs ?? []).map((c) => c.state))
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 2000))
  const after = await page.evaluate(() => ({
    playerGone: !document.querySelector('.bookplayer'),
    contexts: (window.__ctxs ?? []).map((c) => c.state),
  }))
  console.log(`audio  while playing ${JSON.stringify(before)}`)
  console.log(`audio  after closing ${JSON.stringify(after)}`)
} finally {
  await browser.close()
}
