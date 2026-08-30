/** Prints the reading-pose camera for each tent. node tools/qa/cam.mjs */
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find((p) => existsSync(p))
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-first-run'] })
for (const i of [0, 1, 2]) {
  const page = await b.newPage()
  await page.setViewport({ width: 1600, height: 900 })
  await page.goto(`http://localhost:5174/?room=${i}&travel=1&book=0`, { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 7000))
  console.log(i, JSON.stringify(await page.evaluate(() => ({ cam: window.__cam, books: window.__books }))))
  await page.close()
}
await b.close()
