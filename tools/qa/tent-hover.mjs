import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((path) => existsSync(path))

if (!executablePath) throw new Error('Chrome not found')

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const problems = []
  page.on('console', (message) => {
    const value = message.text()
    if (message.type() === 'error' && !value.includes('glGetProgramiv')) problems.push(value)
  })
  page.on('pageerror', (error) => problems.push(error.message))

  await page.goto('http://localhost:5173/?hot=1&reveal=1', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas')
  await new Promise((resolve) => setTimeout(resolve, 30_000))

  const selected = await page.evaluate(() => {
    const result = []
    window.__camp.scene.traverse((object) => {
      if (object.isMesh && object.layers.isEnabled(10)) result.push(object.name || '(tent mesh)')
    })
    return result
  })
  // Capture the collision-risk frame, not a random point in the chevron loop.
  await page.addStyleTag({
    content: '.tentsign__arrow { animation: none !important; transform: translateY(6px) !important; }',
  })
  await page.screenshot({ path: 'tools/shots/tent-hover-arrow-lowest.png' })

  console.log(JSON.stringify({ selected, problems }, null, 2))
  if (!selected.length) throw new Error('No tent meshes were selected for the outline')
  if (problems.length) throw new Error('Browser errors detected')
} finally {
  await browser.close()
}
