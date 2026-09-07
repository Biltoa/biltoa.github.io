const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')
const source = path.join(
  root,
  'tools',
  'build',
  'tex',
  'Trees',
  'T_Tree_Campsite_04_Billboard.png'
)
const destination = path.join(root, 'public', 'textures', 'impostors-preview')

// These are the two atlas cells whose trunks are genuinely upright. The other
// six cells are alternate/oblique views and must never be shown together on a
// billboard card.
const selections = [
  {
    name: 'tree-upright-a.webp',
    seed: [58, 92],
    trunk: (width, height) => `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <path d="M ${width * 0.47} ${height * 0.91}
                 C ${width * 0.48} ${height * 0.76}, ${width * 0.47} ${height * 0.48}, ${width * 0.48} ${height * 0.24}
                 L ${width * 0.53} ${height * 0.24}
                 C ${width * 0.53} ${height * 0.49}, ${width * 0.55} ${height * 0.76}, ${width * 0.55} ${height * 0.91}
                 Z" fill="#5a301b"/>
        <path d="M ${width * 0.49} ${height * 0.84}
                 Q ${width * 0.45} ${height * 0.91}, ${width * 0.39} ${height - 7}
                 Q ${width * 0.47} ${height * 0.96}, ${width * 0.52} ${height * 0.87} Z
                 M ${width * 0.53} ${height * 0.84}
                 Q ${width * 0.57} ${height * 0.91}, ${width * 0.64} ${height - 7}
                 Q ${width * 0.55} ${height * 0.96}, ${width * 0.51} ${height * 0.87} Z" fill="#4a2718"/>
      </svg>`,
  },
  {
    name: 'tree-upright-b.webp',
    seed: [410, 250],
    trunk: (width, height) => `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <path d="M ${width * 0.47} ${height * 0.90}
                 C ${width * 0.49} ${height * 0.70}, ${width * 0.48} ${height * 0.40}, ${width * 0.49} ${height * 0.16}
                 L ${width * 0.54} ${height * 0.16}
                 C ${width * 0.54} ${height * 0.41}, ${width * 0.55} ${height * 0.70}, ${width * 0.56} ${height * 0.90}
                 Z" fill="#57301d"/>
        <path d="M ${width * 0.49} ${height * 0.83}
                 Q ${width * 0.45} ${height * 0.91}, ${width * 0.37} ${height - 7}
                 Q ${width * 0.47} ${height * 0.96}, ${width * 0.53} ${height * 0.86} Z
                 M ${width * 0.54} ${height * 0.83}
                 Q ${width * 0.58} ${height * 0.91}, ${width * 0.67} ${height - 7}
                 Q ${width * 0.56} ${height * 0.96}, ${width * 0.51} ${height * 0.86} Z" fill="#472619"/>
      </svg>`,
  },
]

const ALPHA_THRESHOLD = 8
const PAD = 7

async function main() {
  const { data: sourceData, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  fs.mkdirSync(destination, { recursive: true })

  for (const selection of selections) {
    const data = Buffer.from(sourceData)
    const alphaAt = (index) => data[index * channels + 3]
    const [seedX, seedY] = selection.seed
    let seed = -1
    let bestDistance = Infinity
    for (let y = Math.max(0, seedY - 24); y <= Math.min(height - 1, seedY + 24); y++) {
      for (let x = Math.max(0, seedX - 24); x <= Math.min(width - 1, seedX + 24); x++) {
        const index = y * width + x
        if (alphaAt(index) < ALPHA_THRESHOLD) continue
        const distance = (x - seedX) ** 2 + (y - seedY) ** 2
        if (distance < bestDistance) {
          seed = index
          bestDistance = distance
        }
      }
    }
    if (seed < 0) throw new Error(`${selection.name}: no opaque pixel near seed`)

    const component = new Uint8Array(width * height)
    const queue = new Int32Array(width * height)
    let head = 0
    let tail = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    queue[tail++] = seed
    component[seed] = 1

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (component[next] || alphaAt(next) < ALPHA_THRESHOLD) continue
          component[next] = 1
          queue[tail++] = next
        }
      }
    }

    // Preserve the original antialiased fringe around the selected opaque
    // component while deleting every neighboring packed atlas cell.
    const keep = new Uint8Array(component)
    for (let pass = 0; pass < 2; pass++) {
      const expanded = new Uint8Array(keep)
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = y * width + x
          if (keep[index]) continue
          let touches = false
          for (let dy = -1; dy <= 1 && !touches; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (keep[index + dy * width + dx]) {
                touches = true
                break
              }
            }
          }
          if (touches) expanded[index] = 1
        }
      }
      keep.set(expanded)
    }

    for (let index = 0; index < width * height; index++) {
      if (!keep[index]) data[index * channels + 3] = 0
    }

    const left = Math.max(0, minX - PAD)
    const top = Math.max(0, minY - PAD)
    const right = Math.min(width - 1, maxX + PAD)
    const bottom = Math.min(height - 1, maxY + PAD)

    const isolatedTree = await sharp(data, { raw: info })
      .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
      .png()
      .toBuffer()

    const outputWidth = right - left + 1
    const outputHeight = bottom - top + 1
    const compositedTree = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      // The source atlas has tiny transparent cuts through several trunks.
      // Paint one continuous, tapered trunk behind the original pixels so the
      // authored leaves and branches stay intact while every tree has a solid
      // path from crown to roots.
      .composite([
        { input: Buffer.from(selection.trunk(outputWidth, outputHeight)) },
        { input: isolatedTree },
      ])
      .png()
      .toBuffer()

    // A single distant card cannot accumulate the many overlapping leaf
    // layers that make the real trees opaque. Close only one-pixel alpha gaps:
    // this removes aurora-coloured pinholes without filling the authored large
    // spaces between branches or changing the outside silhouette.
    const closedAlpha = await sharp(compositedTree)
      .extractChannel(3)
      .dilate(1)
      .erode(1)
      .raw()
      .toBuffer()

    const { data: compositedPixels, info: compositedInfo } = await sharp(compositedTree)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    for (let index = 0; index < outputWidth * outputHeight; index++) {
      compositedPixels[index * compositedInfo.channels + 3] = closedAlpha[index]
    }

    await sharp(compositedPixels, { raw: compositedInfo })
      .webp({ lossless: true, effort: 6 })
      .toFile(path.join(destination, selection.name))

    console.log(`${selection.name}: ${outputWidth}x${outputHeight}, ${tail} connected pixels`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
