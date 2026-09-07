/**
 * Headless screenshots of the running dev server.
 *
 *   node tools/shot.mjs hero
 *   node tools/shot.mjs reading "?room=1&travel=1&book=1&reveal=1"
 *   node tools/shot.mjs perf "?fps=1" --wait 14000 --info
 *   node tools/shot.mjs hero --stats                    # region averages
 *   node tools/shot.mjs hero --ref tools/ref/target.png # compare to a reference
 *
 * Writes `tools/shots/<name>.png` and prints the `?fps=1` reading if one is on
 * screen. It drives headless Chrome over the DevTools protocol rather than
 * using `--screenshot`, for two reasons worth knowing before you "simplify" it:
 *
 * - `--screenshot` fires on the load event, which for a scene that streams a
 *   2MB glTF and compiles a dozen shaders is long before there is anything to
 *   look at. It returns a **grey frame** perhaps one run in four — and a grey
 *   frame is also what a failed shader compile looks like, so the two are
 *   impossible to tell apart.
 * - `--virtual-time-budget` fixes that race but fakes the clock, which makes
 *   any frame-rate reading meaningless.
 *
 * Do **not** pass `--disable-gpu`, and do not "fix" a missing GL context by
 * allowing SwiftShader. Software rasterisation takes minutes per frame on a
 * scene with a 26-layer aurora march in it; the run does not fail, it just
 * never finishes, which is a far more expensive way to find out.
 *
 * Flags:
 *   --wait <ms>   how long to sit on the loaded scene before the shutter.
 *   --info        print console errors and the WebGL renderer string.
 *   --size WxH    viewport. Keep it fixed across runs or nothing compares.
 *   --port <n>    dev server port (default 5173).
 *   --url <url>   full URL, overrides --port.
 *   --stats       print region averages of the shot. See imagestats.mjs.
 *   --ref <png>   compare those averages against a reference frame.
 *   --loader      capture the loading curtain instead of waiting for the camp.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

/* ------------------------------------------------------------------ chrome */

/**
 * Where Chrome lives on this machine.
 *
 * puppeteer-core ships no browser on purpose — that is the difference between
 * it and puppeteer, and it is why installing it costs a few hundred kilobytes
 * rather than a few hundred megabytes. The cost is having to find one.
 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p
  throw new Error(
    `No Chrome found. Set CHROME_PATH. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`
  )
}

/* -------------------------------------------------------------------- args */

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 || i === argv.length - 1 ? fallback : argv[i + 1]
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))

const name = positional[0] ?? 'latest'
const query = positional[1] ?? ''
const wait = Number(flag('wait', 9000))
const [width, height] = flag('size', '1600x900').split('x').map(Number)
const port = flag('port', '5173')
const url = flag('url', `http://localhost:${port}/${query}`)
const info = argv.includes('--info')
const stats = argv.includes('--stats')
const ref = flag('ref', null)
const loader = argv.includes('--loader')
const out = resolve(`tools/shots/${name}.png`)

/* ------------------------------------------------------------------- shoot */

const executablePath = findChrome()

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    // GPU, not SwiftShader. See the header.
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--window-size=${width},${height}`,
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })

  const problems = []
  page.on('console', (m) => {
    // The GL_INVALID_VALUE glGetProgramiv spam is three's parallel-compile
    // probe and means nothing; it would drown everything else.
    const t = m.text()
    if (m.type() === 'error' && !t.includes('glGetProgramiv')) problems.push(`console: ${t}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  // The canvas exists long before the scene does: the GLB, the textures and
  // every shader program are still loading behind the loader.
  const targetSelector = loader ? '.camploader' : '.hero__canvas canvas'
  await page.waitForSelector(targetSelector, { timeout: 60_000 })
  await page.waitForFunction(
    (selector, isLoader) => {
      const element = document.querySelector(selector)
      if (!element) return false
      if (isLoader) {
        const rect = element.getBoundingClientRect()
        return rect.width > 32 && rect.height > 32
      }
      return element.width > 32 && element.height > 32
    },
    { timeout: 60_000 },
    targetSelector,
    loader
  )
  if (!loader) {
    await page.waitForFunction(() => !document.querySelector('.camploader'), {
      timeout: 60_000,
    })
  }

  await new Promise((r) => setTimeout(r, wait))

  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out })

  // A grey frame is what a silently failed shader compile looks like, and it is
  // indistinguishable from a good run unless something checks the context.
  const probe = await page.evaluate((selector, isLoader) => {
    const element = document.querySelector(selector)
    if (!element) return { why: 'no target' }
    const rect = element.getBoundingClientRect()
    if (isLoader) return { renderer: 'loader', why: null, size: [rect.width, rect.height], fps: null }
    const gl = element.getContext('webgl2') || element.getContext('webgl')
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info')
    const fps = document.body.innerText.match(/\d+\s*FPS[^\n]*/i)
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl ? 'unknown' : null,
      why: gl ? null : 'no webgl context',
      size: [element.width, element.height],
      fps: fps ? fps[0] : null,
    }
  }, targetSelector, loader)

  console.log(`shot   tools/shots/${name}.png  ${probe.size?.join('x')}`)
  if (probe.fps) console.log(`fps    ${probe.fps}`)
  if (info || !probe.renderer) {
    console.log(`chrome ${executablePath}`)
    console.log(`gl     ${probe.renderer ?? probe.why}`)
  }
  if (problems.length && (info || problems.length > 2)) {
    console.log('PAGE PROBLEMS')
    for (const p of problems.slice(0, 8)) console.log(`  ${p}`)
  }

  if (stats || ref) {
    const m = await import('./imagestats.mjs')
    if (ref) await m.compare(out, resolve(ref))
    else m.printStats(await m.regionStats(out))
  }
} finally {
  await browser.close()
}
