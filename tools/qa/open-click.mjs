/**
 * Clicks the shut journal and checks that it opens.
 *
 * The cover is a texture on a mesh, so there is nothing in the DOM to press —
 * it has to be a real click on the canvas, and what it did has to be read off
 * the canvas too. Neither dev handle answers this: `__bookSpread` is the leaf
 * the journal is turned to, which is 0 before the click and 0 after it, and
 * the screen-space hint stays in the DOM while it fades. What does answer it is
 * the middle of the frame — dark board before, pale paper after. Also reports
 * anything the page logged, since a framing change that quietly threw would
 * still screenshot fine.
 *
 *   node tools/qa/open-click.mjs 5175 1810 869
 */
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p))

const [port = '5175', W = '1810', H = '869'] = process.argv.slice(2)
const width = Number(W)
const height = Number(H)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage', '--no-first-run'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  const problems = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('glGetProgramiv')) problems.push(`console: ${t}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

  await page.goto(`http://localhost:${port}/?room=1&travel=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas')
  await new Promise((r) => setTimeout(r, 9000))

  /** Mean luminance of a small patch at the middle of the frame. */
  const middle = async () => {
    const shot = await page.screenshot({ clip: { x: width / 2 - 40, y: height / 2 - 40, width: 80, height: 80 } })
    const png = shot.subarray(0)
    // Cheap: the mean byte of the compressed PNG is useless, so decode via the
    // page instead of pulling in an image library for eighty pixels.
    const b64 = png.toString('base64')
    return page.evaluate(
      (d) =>
        new Promise((res) => {
          const img = new Image()
          img.onload = () => {
            const c = document.createElement('canvas')
            c.width = img.width
            c.height = img.height
            const x = c.getContext('2d')
            x.drawImage(img, 0, 0)
            const p = x.getImageData(0, 0, c.width, c.height).data
            let sum = 0
            for (let i = 0; i < p.length; i += 4) sum += (p[i] + p[i + 1] + p[i + 2]) / 3
            res(Math.round(sum / (p.length / 4)))
          }
          img.src = `data:image/png;base64,${d}`
        }),
      b64
    )
  }
  const before = await middle()
  // The middle of the board, which the framing work moved down the frame.
  await page.mouse.click(Math.round(width * 0.5), Math.round(height * 0.56))
  await new Promise((r) => setTimeout(r, 4500))
  const after = await middle()
  await page.screenshot({ path: 'tools/shots/open-click.png' })

  console.log(`middle  before ${before}  after ${after}`)
  console.log(problems.length ? `PROBLEMS\n  ${problems.slice(0, 8).join('\n  ')}` : 'no console errors')
  console.log(after > before + 40 ? 'PASS  the journal opened' : 'FAIL  the click did not open it')
} finally {
  await browser.close()
}
