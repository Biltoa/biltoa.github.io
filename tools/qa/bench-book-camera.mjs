import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((path) => existsSync(path))

if (!chrome) throw new Error('Chrome not found')

const requestedRoom = Number.parseInt(process.env.QA_ROOM ?? '0', 10)
const room = Math.min(2, Math.max(0, Number.isFinite(requestedRoom) ? requestedRoom : 0))
const shot = (name) => (room === 0 ? name : name.replace('.png', `-${room}.png`))

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  const problems = []
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' && !text.includes('glGetProgramiv')) problems.push(text)
  })
  page.on('pageerror', (error) => problems.push(error.message))

  await page.goto(`http://localhost:5173/?room=${room}&reveal=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas')
  await new Promise((resolve) => setTimeout(resolve, 30_000))

  const closed = await page.evaluate(() => window.__cam)
  const closedOutlineState = await page.evaluate(() => window.__campOutline)
  const closedBookScaleBefore = await page.evaluate((i) => window.__bookHoverScale?.[i] ?? 1, room)
  await page.screenshot({ path: shot('tools/shots/bench-book-closed.png') })

  const selectedCount = () =>
    page.evaluate(() => {
      let count = 0
      window.__camp.scene.traverse((object) => {
        if (object.isMesh && object.layers.isEnabled(10)) count++
      })
      return count
    })

  // The first closed journal uses the shared outline as a page-load FTUE. It is
  // independent of hover, and moving the pointer away must not turn it off.
  await page.mouse.move(800, 504)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const closedBookOutline = await selectedCount()
  const hoveredOutlineState = await page.evaluate(() => window.__campOutline)
  const closedBookScaleAfter = await page.evaluate((i) => window.__bookHoverScale?.[i] ?? 1, room)
  await page.screenshot({ path: shot('tools/shots/bench-book-hovered.png') })

  await page.mouse.move(20, 430)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const awayFromBookOutline = await selectedCount()
  const awayOutlineState = await page.evaluate(() => window.__campOutline)

  // A closed-book exit must start pulling away from this wide composition. It
  // must not first adopt the close reading lens reserved for an opened book.
  await page.evaluate(() => document.querySelector('.doorback')?.click())
  await new Promise((resolve) => setTimeout(resolve, 60))
  const unopenedExitStart = await page.evaluate(() => window.__cam)
  const exitingOutlineState = await page.evaluate(() => window.__campOutline)
  const exitHoverGuardMs = await page.evaluate(
    () => (window.__campHoverResumeAt ?? 0) - (window.__campHoverExitAt ?? 0)
  )
  await page.screenshot({ path: shot('tools/shots/bench-book-unopened-exit.png') })
  await page.waitForFunction(() => window.__campHoverReady === true, { timeout: 6000 })

  const tentTargets = [
    { x: 240, y: 475 },
    { x: 740, y: 475 },
    { x: 1230, y: 475 },
  ]
  await page.mouse.move(tentTargets[room].x, tentTargets[room].y)
  await page.mouse.click(tentTargets[room].x, tentTargets[room].y)
  await page.waitForFunction(
    (i) =>
      window.__cam?.travel > 0.99 &&
      window.__campOutline?.desired?.kind === 'book' &&
      window.__campOutline?.desired?.index === i,
    { timeout: 12_000 },
    room
  )
  await new Promise((resolve) => setTimeout(resolve, 500))

  await page.mouse.click(800, 450)
  await new Promise((resolve) => setTimeout(resolve, 3_500))
  const opened = await page.evaluate(() => window.__cam)
  const openedBookOutline = await selectedCount()
  await page.screenshot({ path: shot('tools/shots/bench-book-open.png') })

  await page.click('.doorback')
  await new Promise((resolve) => setTimeout(resolve, 450))
  const exiting = await page.evaluate(() => window.__cam)
  await page.screenshot({ path: shot('tools/shots/bench-book-exiting.png') })

  // The cue is per visit, not first-use state. Return to the same tent without
  // reloading and verify the book is outlined again after the 1.5s delay.
  await new Promise((resolve) => setTimeout(resolve, 5_500))
  await page.mouse.move(tentTargets[room].x, tentTargets[room].y)
  await page.mouse.click(tentTargets[room].x, tentTargets[room].y)
  await new Promise((resolve) => setTimeout(resolve, 1_700))
  const repeatVisitOutline = await selectedCount()

  console.log(
    JSON.stringify(
      {
        closed,
        unopenedExitStart,
        opened,
        exiting,
        closedBookOutline,
        closedOutlineState,
        hoveredOutlineState,
        awayOutlineState,
        closedBookScaleBefore,
        closedBookScaleAfter,
        awayFromBookOutline,
        openedBookOutline,
        repeatVisitOutline,
        exitingOutlineState,
        exitHoverGuardMs,
        problems,
      },
      null,
      2
    )
  )
  if (closedBookOutline !== 1) throw new Error('Closed book did not own exactly one outline target')
  if (closedBookScaleAfter < closedBookScaleBefore + 0.02) {
    throw new Error('Closed-book scale did not activate with its hover outline')
  }
  if (awayFromBookOutline !== 1) throw new Error('First-use book outline still depends on hover')
  if (openedBookOutline !== 0) throw new Error('Book cue remained after the book opened')
  if (repeatVisitOutline !== 1) throw new Error('Book cue did not reset on the next tent visit')
  if (exitingOutlineState?.desired !== null) {
    throw new Error('An outline remained requested during exit')
  }
  if (!(exitingOutlineState?.strength < closedOutlineState?.strength)) {
    throw new Error('Outline did not begin fading during exit')
  }
  if (
    closedOutlineState?.pulseSpeed !== 0.35 ||
    hoveredOutlineState?.pulseSpeed !== 0.35 ||
    awayOutlineState?.pulseSpeed !== 0.35
  ) {
    throw new Error('Book pulse changed when hover state changed')
  }
  if (exitHoverGuardMs !== 1000) {
    throw new Error(`Post-exit hover guard was ${exitHoverGuardMs}ms, expected about 1000ms`)
  }
  if (!(unopenedExitStart.travel < closed.travel && unopenedExitStart.bookOpen < 0.03)) {
    throw new Error('Closed-book exit did not begin immediately')
  }
  if (!(unopenedExitStart.fov > closed.fov - 4)) {
    throw new Error('Closed-book exit zoomed toward the book before pulling out')
  }
  if (!(opened.fov < closed.fov - 10)) throw new Error('Book did not zoom in')
  if (!(exiting.travel < 0.99 && exiting.bookOpen > 0.03)) {
    throw new Error('Exit waited for the book instead of starting immediately')
  }
  if (problems.length) throw new Error('Browser errors detected')
} finally {
  await browser.close()
}
