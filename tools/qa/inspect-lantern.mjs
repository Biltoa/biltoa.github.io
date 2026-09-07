import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((path) => existsSync(path))

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 2048, height: 1020, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/?room=1&travel=1&book=0&reveal=1', {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('canvas')
  await new Promise((resolve) => setTimeout(resolve, 22_000))

  const result = await page.evaluate(() => {
    const state = window.__camp
    const objects = []
    state.scene.updateMatrixWorld(true)
    const pillow = state.scene.getObjectByName('RestoredPillow2')
    if (pillow) {
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      pillow.traverse((object) => {
        if (!object.geometry) return
        object.geometry.computeBoundingBox()
        const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], box.min.getComponent(axis))
          max[axis] = Math.max(max[axis], box.max.getComponent(axis))
        }
      })
      objects.push({
        name: pillow.name,
        bounds: { min, max },
      })
    }
    state.scene.traverse((object) => {
      const material = object.material
      const isFlame = material?.uniforms?.uFlicker
      const isLantern = /Lantern|Candle_Wick|Candle_2/.test(object.name)
      if (!isFlame && !isLantern) return
      const world = object.getWorldPosition(object.position.clone())
      const screen = world.clone().project(state.camera)
      const sx = (screen.x + 1) * 1024
      const sy = (1 - screen.y) * 510
      if (sx < -300 || sx > 2348 || sy < -300 || sy > 1320) return
      object.geometry?.computeBoundingBox()
      const bounds = object.geometry?.boundingBox?.clone().applyMatrix4(object.matrixWorld)
      objects.push({
        name: object.name || '(flame)',
        visible: object.visible,
        world: world.toArray(),
        screen: [sx, sy],
        scale: object.getWorldScale(object.scale.clone()).toArray(),
        localBounds: object.geometry?.boundingBox
          ? {
              min: object.geometry.boundingBox.min.toArray(),
              max: object.geometry.boundingBox.max.toArray(),
            }
          : null,
        worldMatrix: object.matrixWorld.elements,
        bounds: bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
        material: material?.name,
        materialProps: material ? {
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
          depthTest: material.depthTest,
        } : null,
      })
    })
    return objects
  })
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
