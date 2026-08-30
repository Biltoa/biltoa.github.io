/**
 * Drives the Unity editor over the Synaptic HTTP bridge, opening each portfolio
 * tool window at a pinned desktop rectangle, grabbing the screen, and cropping
 * the window out of it.
 *
 * Unity's own screenshot tools only see the Game and Scene views, so an
 * EditorWindow can only be captured from the desktop side. The windows pin
 * themselves to a known rect (see PortfolioToolCapture.cs), which is what makes
 * the crop below a constant rather than a window-hunt.
 *
 *   node tools/shoot-unity-tools.mjs            # all of them
 *   node tools/shoot-unity-tools.mjs 3 5        # just those
 */
import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

const BRIDGE = 'http://localhost:8086/execute'
const OUT_DIR = path.resolve('public/media/tools')
const TMP = path.resolve('node_modules/.cache/unity-shots')

/** Matches PortfolioToolCapture.X / .Y. */
const ORIGIN = { x: 200, y: 120 }

/** Native window furniture around the client rect, measured once. */
const FRAME = { left: 3, top: 33, width: 7, height: 37 }

/**
 * `book` is a second, tighter crop for the journal page, given in client
 * coordinates inside the window.
 *
 * The full window is portrait and the plate on the page is landscape, so
 * letterboxing a whole window into it lands at about a third scale — Unity's
 * 11px editor type comes out at four pixels, which reads as a coloured smear
 * rather than as an editor. The book crop is roughly the plate's own aspect and
 * frames the part of each tool worth recognising, so it lands near full size.
 */
const TOOLS = [
  { n: 1, menu: '1 Mesh Atlas Builder', slug: 'mesh-atlas-builder', w: 700, h: 1180,
    book: { left: 0, top: 600, width: 700, height: 380 } },
  { n: 2, menu: '2 GPU Instanced Painter', slug: 'gpu-instanced-painter', w: 760, h: 1080,
    book: { left: 0, top: 120, width: 760, height: 400 } },
  { n: 3, menu: '3 Icon Generator', slug: 'icon-generator', w: 1060, h: 800,
    book: { left: 0, top: 300, width: 745, height: 400 } },
  { n: 4, menu: '4 Shadow Baker', slug: 'shadow-baker', w: 720, h: 1030,
    book: { left: 0, top: 400, width: 720, height: 390 } },
  { n: 5, menu: '5 Texture Optimizer', slug: 'texture-optimizer', w: 1100, h: 800,
    book: { left: 0, top: 220, width: 1090, height: 590 } },
  { n: 6, menu: '6 LOD Baker', slug: 'lod-baker', w: 720, h: 1060,
    book: { left: 0, top: 200, width: 720, height: 390 } },
  { n: 7, menu: '7 Validator', slug: 'validator', w: 1040, h: 730,
    book: { left: 0, top: 180, width: 1030, height: 560 } },
  { n: 8, menu: '8 Build Pipeline', slug: 'build-pipeline', w: 960, h: 1060,
    book: { left: 0, top: 220, width: 950, height: 515 } },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A menu item invoked while the editor is mid-domain-reload answers 500 — the
 * item genuinely does not exist for those few hundred milliseconds. Retrying is
 * the fix; failing the run is not.
 */
async function bridge(tool, params = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(BRIDGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, params }),
    })
    if (res.ok) return res.json()
    if (i === tries - 1) throw new Error(`${tool}: HTTP ${res.status}`)
    await sleep(1500)
  }
}

async function grab(file) {
  // Anything in front of Unity lands in the grab. A browser window showing this
  // portfolio is an especially confusing thing to find in a screenshot of a
  // Unity tool, so the editor is pulled forward every time rather than once.
  const { stdout } = await run('powershell', [
    '-ExecutionPolicy', 'Bypass', '-File', 'tools/focus-unity.ps1',
  ])
  if (stdout.includes('unity-window-not-found')) throw new Error('Unity has no visible window')
  await sleep(400)

  await run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'tools/grab-screen.ps1', '-Out', file])
}

/**
 * Blocks until the editor is neither compiling nor reloading its domain.
 *
 * A capture taken during a reload is a screenshot of the "Reloading Domain"
 * overlay sitting on top of a window whose fields have been reset — which looks
 * exactly like a working screenshot until you read the numbers on it.
 */
async function waitIdle() {
  for (let i = 0; i < 60; i++) {
    const res = await bridge('unity_get_error_status').catch(() => null)
    if (res && !String(res.result).includes('isCompiling: True')) {
      // The overlay outlives the flag by a beat.
      await sleep(1200)
      return
    }
    await sleep(2000)
  }
  throw new Error('Unity never stopped compiling')
}

async function shoot(tool) {
  await waitIdle()
  await bridge('unity_execute_menu_item', { menuPath: `Tools/Portfolio/Capture/${tool.menu}` })
  // The window paints on Unity's own tick, and PrepareForCapture runs a pass
  // before it does. A beat here is the difference between a finished window and
  // a half-drawn one.
  await sleep(1400)

  const raw = path.join(TMP, `${tool.slug}-raw.png`)
  await grab(raw)

  const crop = {
    left: ORIGIN.x - FRAME.left,
    top: ORIGIN.y - FRAME.top,
    width: tool.w + FRAME.width,
    height: tool.h + FRAME.height,
  }

  const out = path.join(OUT_DIR, `${tool.slug}.png`)
  await sharp(raw).extract(crop).png({ compressionLevel: 9 }).toFile(out)

  // A second copy for the journal: the tighter crop, lifted a little. Unity's
  // dark editor chrome pasted onto aged paper and then lit by two candles comes
  // out muddy, so the contrast goes up before the scene's lighting takes it
  // back down. Only a little — pushed hard it stops looking like Unity.
  const forBook = path.join(OUT_DIR, `${tool.slug}-book.png`)
  await sharp(raw)
    .extract({
      left: crop.left + tool.book.left,
      // The window furniture sits above the client area, and the book crop is
      // measured from the client origin.
      top: crop.top + FRAME.top + tool.book.top,
      width: Math.min(tool.book.width, crop.width - tool.book.left),
      height: Math.min(tool.book.height, crop.height - FRAME.top - tool.book.top),
    })
    .modulate({ brightness: 1.2 })
    .linear(1.1, -6)
    .png({ compressionLevel: 9 })
    .toFile(forBook)

  console.log(`${tool.n}. ${tool.slug}  ->  ${path.relative(process.cwd(), out)}  (+ -book)`)
}

const want = process.argv.slice(2).map(Number).filter(Boolean)
const list = want.length ? TOOLS.filter((t) => want.includes(t.n)) : TOOLS

await mkdir(OUT_DIR, { recursive: true })
await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })

// A recompile disconnects the editor from the bridge for a few seconds. Wait it
// out rather than failing the run.
let health
for (let i = 0; ; i++) {
  health = await fetch('http://localhost:8086/health').then((r) => r.json()).catch(() => ({}))
  if (health.unityConnected) break
  if (i === 40) throw new Error('Unity bridge is up but the editor never reconnected')
  await sleep(2000)
}

for (const t of list) await shoot(t)
