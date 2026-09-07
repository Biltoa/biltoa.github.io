/**
 * Profiles the exact clearing -> tent -> clearing -> tent camera path.
 *
 *   node tools/qa/profile-transitions.mjs [port]
 *
 * The report separates frame pacing by phase and prints the hottest sampled
 * main-thread functions. It runs against a production preview by default so
 * React/dev shader diagnostics do not distort the result.
 */
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
  .filter(Boolean)
  .find((path) => existsSync(path))
if (!CHROME) throw new Error('No Chrome found. Set CHROME_PATH.')

const port = process.argv[2] ?? '4173'
const variantArg = process.argv[3]?.startsWith('--') ? '' : process.argv[3]
const variant = variantArg ? `&${variantArg}` : ''
const short = process.argv.includes('--short')
const width = 1600
const height = 900
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-dev-shm-usage',
    '--no-first-run',
    `--window-size=${width},${height}`,
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => {
    window.__transitionPhase = 'load'
    window.__transitionFrames = []
    window.__transitionLongTasks = []
    let previous = 0
    const frame = (now) => {
      if (previous) {
        window.__transitionFrames.push({
          phase: window.__transitionPhase,
          dt: now - previous,
        })
      }
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__transitionLongTasks.push({
            phase: window.__transitionPhase,
            duration: entry.duration,
          })
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      // The rAF distribution remains valid if Long Tasks is unavailable.
    }
  })

  await page.goto(`http://127.0.0.1:${port}/?fps=0&profile=1${variant}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('canvas')
  // The safety timeout releases the curtain at 20 seconds even on headless
  // machines whose software WebGL compiler is much slower than a real GPU.
  // Waiting 27 seconds also excludes the loader-contained warm-up sweep.
  await pause(27_000)
  await page.evaluate(() => {
    window.__transitionFrames.length = 0
    window.__transitionLongTasks.length = 0
  })

  const cdp = await page.createCDPSession()
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  await cdp.send('Profiler.start')

  const programSnapshots = []
  const phase = async (name) => {
    const snapshot = await page.evaluate((value) => {
      window.__transitionPhase = value
      const programs = window.__camp?.gl.info.programs ?? []
      const owners = {}
      if (window.__camp) {
        window.__camp.scene.traverse((object) => {
          if (!object.material) return
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) {
            const key = window.__camp.gl.properties.get(material)?.currentProgram?.cacheKey
            if (!key) continue
            ;(owners[key] ??= []).push(`${object.name || object.type}:${material.name || material.type}`)
          }
        })
      }
      return {
        phase: value,
        programs: programs.map((program) => program.cacheKey),
        owners,
      }
    }, name)
    programSnapshots.push(snapshot)
  }
  await phase('lobby')
  await pause(1_000)
  await phase('enter-middle')
  await page.mouse.move(740, 475)
  await page.mouse.click(740, 475)
  await pause(5_500)
  await phase('inside-middle')
  await pause(1_000)
  if (!short) {
    await phase('exit-middle')
    await page.click('.doorback')
    await pause(5_500)
    await phase('lobby-returned')
    await pause(1_000)
    await phase('enter-left')
    await page.mouse.move(240, 475)
    await page.mouse.click(240, 475)
    await pause(5_500)
    await phase('inside-left')
    await pause(1_000)
  }

  const { profile } = await cdp.send('Profiler.stop')
  await cdp.send('Profiler.disable')
  const raw = await page.evaluate(() => ({
    frames: window.__transitionFrames,
    longTasks: window.__transitionLongTasks,
  }))

  const grouped = new Map()
  for (const frame of raw.frames) {
    if (!grouped.has(frame.phase)) grouped.set(frame.phase, [])
    grouped.get(frame.phase).push(frame.dt)
  }
  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  console.log(`Transition frame profile — http://127.0.0.1:${port} (${width}x${height}, DPR 1)`)
  for (const [name, values] of grouped) {
    const sorted = [...values].sort((a, b) => a - b)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    console.log(
      `${name.padEnd(18)} n=${String(values.length).padStart(4)}  ` +
        `mean=${mean.toFixed(2).padStart(6)}ms  ` +
        `p95=${percentile(sorted, 0.95).toFixed(2).padStart(6)}ms  ` +
        `max=${Math.max(...values).toFixed(2).padStart(7)}ms  ` +
        `>26=${String(values.filter((value) => value > 26).length).padStart(3)}  ` +
        `>50=${String(values.filter((value) => value > 50).length).padStart(3)}`
    )
  }

  if (raw.longTasks.length) {
    console.log('\nLong tasks')
    for (const task of raw.longTasks) console.log(`${task.phase.padEnd(18)} ${task.duration.toFixed(1)}ms`)
  }

  if (programSnapshots.some((snapshot) => snapshot.programs.length)) {
    console.log('\nRenderer program changes')
    let prior = new Set(programSnapshots[0]?.programs ?? [])
    if (programSnapshots[0]) {
      console.log(
        `${programSnapshots[0].phase.padEnd(18)} total=${String(prior.size).padStart(3)} baseline`
      )
    }
    for (const snapshot of programSnapshots.slice(1)) {
      const next = new Set(snapshot.programs)
      const added = [...next].filter((key) => !prior.has(key))
      const removed = [...prior].filter((key) => !next.has(key))
      console.log(
        `${snapshot.phase.padEnd(18)} total=${String(next.size).padStart(3)} ` +
          `added=${String(added.length).padStart(2)} removed=${String(removed.length).padStart(2)}`
      )
      for (const key of added) {
        const summary = key
          .replace(/\s+/g, ' ')
          .replace(/,precision highp[\s\S]*$/, '')
          .slice(0, 240)
        console.log(`  + ${summary}${key.length > summary.length ? ' …' : ''}`)
        const owners = snapshot.owners[key]
        if (owners?.length) console.log(`    owners: ${owners.slice(0, 10).join(', ')}`)
      }
      prior = next
    }
  }

  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const costs = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i])
    if (!node) continue
    const frame = node.callFrame
    const key = `${frame.functionName || '(anonymous)'}|${frame.url}|${frame.lineNumber + 1}`
    costs.set(key, (costs.get(key) ?? 0) + profile.timeDeltas[i] / 1000)
  }
  console.log('\nSampled main-thread time')
  for (const [key, ms] of [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    const [name, url, line] = key.split('|')
    console.log(`${ms.toFixed(1).padStart(8)}ms  ${name}  ${url ? `${url}:${line}` : ''}`)
  }
} finally {
  await browser.close()
}
