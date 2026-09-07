/**
 * Measures loading-curtain responsiveness, including shader/texture warm-up.
 *
 *   node tools/qa/profile-loader.mjs [port]
 */
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((path) => existsSync(path))
if (!chrome) throw new Error('No Chrome found. Set CHROME_PATH.')

const port = process.argv[2] ?? '4173'
const variant = process.argv[3] ?? ''
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--window-size=1600,900',
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const cdp = await page.createCDPSession()
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  await cdp.send('Profiler.start')
  await page.evaluateOnNewDocument(() => {
    window.__loaderFrames = []
    window.__loaderStarted = performance.now()
    let previous = 0
    const frame = (now) => {
      if (previous) window.__loaderFrames.push(now - previous)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.goto(`http://127.0.0.1:${port}/?fps=0&profile=1${variant ? `&${variant}` : ''}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.waitForSelector('.camploader', { timeout: 60_000 })
  await page.waitForFunction(() => !document.querySelector('.camploader'), {
    timeout: 60_000,
  })
  const { profile } = await cdp.send('Profiler.stop')
  await cdp.send('Profiler.disable')
  const sample = await page.evaluate(() => ({
    elapsed: performance.now() - window.__loaderStarted,
    frames: window.__loaderFrames,
    interfaces: window.__warmInterfaceTimings ?? [],
  }))
  const sorted = [...sample.frames].sort((a, b) => a - b)
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
  console.log(
    `Loader profile — http://127.0.0.1:${port}${variant ? ` ${variant}` : ''} (1600x900, DPR 1)`
  )
  console.log(`ready=${sample.elapsed.toFixed(0)}ms frames=${sample.frames.length}`)
  console.log(
    `p95=${percentile(0.95).toFixed(2)}ms max=${Math.max(...sample.frames).toFixed(2)}ms ` +
      `>50=${sample.frames.filter((value) => value > 50).length} ` +
      `>100=${sample.frames.filter((value) => value > 100).length}`
  )
  console.log('Slow program interfaces')
  for (const item of sample.interfaces.slice(0, 5)) {
    console.log(`${item.index}: ${item.ms.toFixed(1)}ms ${item.key}`)
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
  console.log('Sampled main-thread time')
  for (const [key, ms] of [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const [name, url, line] = key.split('|')
    console.log(`${ms.toFixed(1).padStart(8)}ms  ${name}  ${url ? `${url}:${line}` : ''}`)
  }
} finally {
  await browser.close()
}
