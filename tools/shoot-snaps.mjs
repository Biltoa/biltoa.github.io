/**
 * The three prints taped onto the gameplay journal's field-notes page.
 *
 * Each one is a different hour, a different car, and — for the last — a car
 * standing still, so the cluster reads as a set of photographs rather than as
 * three frames of the same corner.
 *
 *   node tools/shoot-snaps.mjs --headful
 *   node tools/shoot-snaps.mjs --headful --steps 0,10,14
 *   node tools/shoot-snaps.mjs --headful --steps 0,11,12 --only 3
 *
 * Every shot gets its own page load. That is slower than driving one session
 * through all three, and it is the only thing that works: after a slide the car
 * is somewhere unhelpful, and swapping cars drops it there too — two runs of
 * the single-session version came back with a car parked nose to the armco
 * reading 0 KPH. A fresh load puts it back on the grid, pointing down the
 * track, every time. The build is a quarter of a gigabyte but it comes out of
 * the disk cache after the first load.
 *
 * The clock is driven by ShotTimeKeys.cs in the Unity project: 7 anchors it at
 * noon and 9 walks it forward half an hour a press. `--steps` is how many
 * presses each shot gets, which is how the sunset and dusk hours were found —
 * COZY's own profile decides when the light goes, and it goes earlier than a
 * clock would suggest.
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

const stepArg = process.argv.indexOf('--steps')
const STEPS = stepArg > -1 ? process.argv[stepArg + 1].split(',').map(Number) : [0, 10, 13]

const onlyArg = process.argv.indexOf('--only')
/** 1-based, or 0 for all three. Reshoots one print without risking the others. */
const ONLY = onlyArg > -1 ? Number(process.argv[onlyArg + 1]) : 0

const OUT = resolve('public/media/build')
mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** What each print is of. `car` is null for whichever one the build starts on. */
const SHOTS = [
  { out: 'snap-1.png', what: 'noon, first car, sideways', car: null, park: false },
  { out: 'snap-2.png', what: 'sunset, second car, sideways', car: 'Digit2', park: false },
  { out: 'snap-3.png', what: 'dusk, third car, standing', car: 'Digit3', park: true },
]

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
  for (let i = 0; i < SHOTS.length; i++) {
    if (ONLY && i + 1 !== ONLY) continue
    const shot = SHOTS[i]
    const steps = STEPS[i] ?? 0
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.log(`pageerror ${e.message}`))

    // Headless Chrome reports the page as unfocused, and Unity WebGL gates its
    // input handling on that — every synthesised click and key was being
    // delivered to a canvas that believed nobody was looking at it.
    await page.bringToFront()
    const cdp = await page.createCDPSession()
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })

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
    // The printed plate is only pressable once the camera has arrived and the
    // ink has finished landing.
    await wait(9000)

    // Same point tools/probe-play.mjs presses, at the same frame size.
    const px = Math.round(1280 * 0.644)
    const py = Math.round(720 * 0.328)
    await page.mouse.move(px, py)
    await wait(350)
    await page.mouse.click(px, py)
    await wait(1500)
    if (!(await page.evaluate(() => !!document.querySelector('.bookplayer')))) {
      throw new Error('pressing the plate did not open the player')
    }

    await page
      .waitForFunction(() => !document.querySelector('.bookplayer__veil'), {
        timeout: 900_000,
        polling: 2000,
      })
      .catch(() => console.log('veil never cleared, grabbing anyway'))

    // An element screenshot captures the page region under that element, which
    // includes anything drawn on top of it. Without this every frame comes back
    // with the player's own controls bar and the dev FPS badge printed across
    // the game — and those then end up on a page of the journal.
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

    /**
     * Clicks a point given as a fraction of the canvas.
     *
     * Moved-then-pressed rather than `mouse.click`: Unity's UI raycaster wants
     * a pointer-enter on the button before it will accept the press, and a
     * synthesised click that arrives with no movement in front of it lands on a
     * button that never entered its hover state.
     */
    const clickAt = async (fx, fy) => {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
      await wait(300)
      await page.mouse.down()
      await wait(120)
      await page.mouse.up()
    }

    const hold = async (key, ms) => {
      await page.keyboard.down(key)
      await wait(ms)
      await page.keyboard.up(key)
    }

    /**
     * Moves the pointer out of shot before the shutter.
     *
     * The build draws its own cursor into the canvas, so an element screenshot
     * catches it — and the click that focuses the canvas leaves it sitting on
     * the gear indicator, dead centre. The prints are cover-cropped to 3:2 out
     * of a 16:9 frame, which throws away the outer 7.8% of each side, so a
     * pointer parked at 1.5% across is off the paper rather than merely out of
     * the way.
     */
    const shoot = async (out) => {
      await page.mouse.move(box.x + box.width * 0.015, box.y + box.height * 0.5)
      await wait(220)
      const el = await page.$('.bookplayer__frame canvas')
      if (!el) throw new Error('no unity canvas')
      await el.screenshot({ path: out })
    }

    // The build opens on its own controls card. Dismiss it, or every frame is a
    // screenshot of a menu.
    await wait(4000)
    await clickAt(0.5, 0.8)
    await clickAt(0.74, 0.229)
    await wait(700)
    // Belt and braces: some builds close their intro card on a key instead.
    // Escape is deliberately not in this list — the journal's player takes
    // Escape as "put the build away", so pressing it here closed the very thing
    // being captured.
    for (const k of ['Enter', 'Space']) {
      await page.keyboard.press(k)
      await wait(250)
    }
    await wait(900)

    await page.evaluate(() => document.querySelector('#unity-canvas')?.focus())
    await clickAt(0.5, 0.8)

    if (shot.car) {
      await page.keyboard.press(shot.car)
      await wait(2200)
      await clickAt(0.5, 0.8)
      await page.evaluate(() => document.querySelector('#unity-canvas')?.focus())
    }

    // Anchor the clock at noon, then walk it forward.
    await page.keyboard.press('Digit7')
    for (let s = 0; s < steps; s++) {
      await page.keyboard.press('Digit9')
      await wait(90)
    }
    await wait(600)

    if (shot.park) {
      // Out onto clean road first and then braked: stopped where it starts, the
      // car is sitting on the grid markings, and stopped after a slide it is in
      // the runoff on top of its own tyre marks.
      // Lights first: at dusk they are half the reason to photograph a
      // stationary car, and toggling them after the car has stopped meant the
      // shutter caught the frame before the lamps came up.
      await page.keyboard.press('KeyL')
      await wait(400)
      await hold('w', 4200)
      // Brake, then hold it on the handbrake. Braking alone does not park a
      // car: S is brake *and* reverse, so three seconds of it stopped the car
      // and then backed it up the road, and the shot came out at 10 KPH in R
      // with the chase camera swung round to face the nose.
      await hold('s', 1400)
      await page.keyboard.down('Space')
      // Wait out the tyre smoke as well as the suspension. Two seconds was
      // enough for the body to stop rocking and nowhere near enough for the
      // cloud the handbrake throws up, which covered a third of the frame.
      await wait(5200)
    } else {
      // Long enough on the throttle to be in fourth, then a dab of lock with
      // the handbrake. The throttle stays down through it, which is what keeps
      // the car pointing somewhere rather than spinning.
      await page.keyboard.down('w')
      await wait(5600)
      await page.keyboard.down(i === 0 ? 'a' : 'd')
      await hold('Space', 520)
      await wait(360)
      await page.keyboard.up(i === 0 ? 'a' : 'd')
      await wait(380)
    }

    await shoot(resolve(OUT, shot.out))
    await page.keyboard.up('w')
    await page.keyboard.up('Space')
    console.log(`snap   ${i + 1}  ${shot.what}  (+${steps} half-hours from noon)`)

    await page.keyboard.press('Escape')
    await wait(1200)
    await page.close()
  }
} finally {
  await browser.close()
}
