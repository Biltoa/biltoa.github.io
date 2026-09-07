import { existsSync, mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((path) => existsSync(path))

if (!chrome) throw new Error('Chrome not found')
mkdirSync('tools/shots', { recursive: true })

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const problems = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('glGetProgramiv')) {
      problems.push(message.text())
    }
  })

  await page.goto('http://localhost:5173/?room=0&travel=1&reveal=1', {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__cam?.travel > 0.99, { timeout: 30_000 })
  await new Promise((resolve) => setTimeout(resolve, 1200))

  // Open the closed cover, then throw blank paper on the right toward the fold
  // in one pointer event. The target may jump; the rendered leaf must not.
  await page.mouse.click(800, 500)
  await page.waitForFunction(() => window.__cam?.bookOpen > 0.94, { timeout: 12_000 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  await page.screenshot({ path: 'tools/shots/book-page-baseline.png' })

  await page.mouse.move(1120, 590)
  await page.mouse.down()
  await page.mouse.move(650, 590)
  const highDpiJump = await page.evaluate(() => window.__bookTurns?.[0] ?? null)
  await page.waitForFunction(() => (window.__bookTurns?.[0]?.t ?? 0) >= 0.3)
  const dragged = await page.evaluate(() => window.__bookTurns?.[0] ?? null)
  await page.screenshot({ path: 'tools/shots/book-page-dragged.png' })
  // Keep the pointer captured while checking both troublesome endpoints. The
  // turning leaf remains rendered at 0% and 100%, so neither endpoint may pick
  // up a shadow that the stationary page beneath it does not receive.
  await page.mouse.move(1120, 590, { steps: 8 })
  await page.waitForFunction(() => window.__bookTurns?.[0]?.t === 0)
  const returnedToStart = await page.evaluate(() => window.__bookTurns?.[0] ?? null)
  await page.screenshot({ path: 'tools/shots/book-page-held-at-start.png' })
  await page.mouse.move(650, 590, { steps: 16 })
  await page.waitForFunction(() => window.__bookTurns?.[0]?.t === 1)
  const draggedLate = await page.evaluate(() => window.__bookTurns?.[0] ?? null)
  await page.screenshot({ path: 'tools/shots/book-page-held-at-end.png' })
  await page.mouse.up()
  await page.waitForFunction(() => window.__bookSpread === 1, { timeout: 5_000 })
  const afterDrag = await page.evaluate(() => window.__bookSpread)
  await page.screenshot({ path: 'tools/shots/book-page-landed.png' })

  // Any unclaimed point on the left page goes backward.
  await page.mouse.click(500, 600)
  await page.waitForFunction(() => window.__bookSpread === 0, { timeout: 5_000 })
  const afterLeftClick = await page.evaluate(() => window.__bookSpread)
  await new Promise((resolve) => setTimeout(resolve, 300))

  // A short pull springs back and leaves the current spread untouched.
  await page.mouse.move(1120, 590)
  await page.mouse.down()
  await page.mouse.move(1050, 590, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => window.__bookTurns?.[0]?.mode === 'idle', { timeout: 3_000 })
  const cancelledDragSpread = await page.evaluate(() => window.__bookSpread)
  await page.waitForFunction(
    () => window.__bookHitRects?.[0]?.some((entry) => entry.to?.startsWith('mailto:')),
    { timeout: 3_000 }
  )

  // A printed mail link must beat the full-page gesture surface beneath it.
  await page.evaluate(() => {
    window.__openedFromBook = null
    window.open = (url) => {
      window.__openedFromBook = String(url)
      return null
    }
  })
  const mailTarget = await page.evaluate(() => {
    const hit = window.__bookHitRects?.[0]?.find((entry) => entry.to?.startsWith('mailto:'))
    if (!hit?.screen) return null
    return {
      x: hit.screen.x + hit.screen.w / 2,
      y: hit.screen.y + hit.screen.h / 2,
    }
  })
  if (!mailTarget) throw new Error('Mail link hit region was not published')
  await page.mouse.move(mailTarget.x, mailTarget.y)
  await new Promise((resolve) => setTimeout(resolve, 120))
  let linkHot = await page.evaluate(() => document.body.classList.contains('camp-hover'))
  let clickablePoint = mailTarget
  // pageScreenRect intentionally returns a cheap axis-aligned approximation;
  // find the rendered mark itself if perspective puts that approximation low.
  if (!linkHot) {
    scan: for (let y = 440; y <= 550; y += 6) {
      for (let x = 840; x <= 1050; x += 10) {
        await page.mouse.move(x, y)
        await new Promise((resolve) => setTimeout(resolve, 18))
        if (await page.evaluate(() => document.body.classList.contains('camp-hover'))) {
          clickablePoint = { x, y }
          linkHot = true
          break scan
        }
      }
    }
  }
  await page.mouse.click(clickablePoint.x, clickablePoint.y)
  await new Promise((resolve) => setTimeout(resolve, 350))
  const interactive = await page.evaluate(() => ({
    opened: window.__openedFromBook,
    spread: window.__bookSpread,
  }))
  await page.screenshot({ path: 'tools/shots/book-page-interactive-check.png' })
  console.log(JSON.stringify({ highDpiJump, dragged, returnedToStart, afterDrag, afterLeftClick, mailTarget, clickablePoint, linkHot, interactive }, null, 2))

  // On the first spread, the left page is the book's close edge.
  await page.mouse.click(500, 600)
  await page.waitForFunction(() => window.__cam?.bookOpen < 0.72, { timeout: 5_000 })
  const firstBoundary = await page.evaluate(() => ({
    closed: window.__cam?.bookOpen < 0.72,
    stayedInTent: window.__cam?.travel > 0.99,
    backLabel: document.querySelector('.doorback')?.textContent?.trim(),
    hasKeycap: Boolean(document.querySelector('.doorback kbd')),
  }))
  await page.screenshot({ path: 'tools/shots/book-page-boundary-close.png' })

  // Symmetric edge rule: the right page on the last spread closes too.
  await page.goto('http://localhost:5173/?room=0&travel=1&spread=2&reveal=1', {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__cam?.travel > 0.99, { timeout: 30_000 })
  await new Promise((resolve) => setTimeout(resolve, 900))
  await page.mouse.click(800, 500)
  await page.waitForFunction(() => window.__cam?.bookOpen > 0.94, { timeout: 12_000 })
  await page.mouse.click(1120, 590)
  await page.waitForFunction(() => window.__cam?.bookOpen < 0.72, { timeout: 5_000 })
  const lastBoundary = await page.evaluate(() => ({
    closed: window.__cam?.bookOpen < 0.72,
    stayedInTent: window.__cam?.travel > 0.99,
  }))

  const result = {
    dragged,
    highDpiJump,
    returnedToStart,
    draggedLate,
    afterDrag,
    afterLeftClick,
    cancelledDragSpread,
    interactive,
    firstBoundary,
    lastBoundary,
    problems,
  }
  console.log(JSON.stringify(result, null, 2))

  if (highDpiJump?.mode !== 'drag' || highDpiJump.t >= 0.75) {
    throw new Error('High-DPI pointer jump bypassed the page-turn speed cap')
  }
  if (dragged?.mode !== 'drag' || dragged.t < 0.2) throw new Error('Page did not follow drag')
  if (returnedToStart?.mode !== 'drag' || returnedToStart.t !== 0) {
    throw new Error('Page did not return to its starting endpoint while held')
  }
  if (draggedLate?.mode !== 'drag' || draggedLate.t !== 1) {
    throw new Error('Page did not reach its ending endpoint while held')
  }
  if (afterDrag !== 1 || afterLeftClick !== 0) throw new Error('Whole-page navigation failed')
  if (cancelledDragSpread !== 0) throw new Error('Cancelled drag changed the spread')
  if (!interactive.opened?.startsWith('mailto:') || interactive.spread !== 0) {
    throw new Error('Interactive page mark lost priority to page navigation')
  }
  if (!firstBoundary.closed) throw new Error('First left page did not close the book')
  if (!firstBoundary.stayedInTent) throw new Error('First-page close left the tent')
  if (firstBoundary.backLabel !== '← Back to the fire' || firstBoundary.hasKeycap) {
    throw new Error('Back-to-fire label still contains the Escape keycap')
  }
  if (!lastBoundary.closed) throw new Error('Last right page did not close the book')
  if (!lastBoundary.stayedInTent) throw new Error('Last-page close left the tent')
  if (problems.length) throw new Error('Browser errors detected')
} finally {
  await browser.close()
}
