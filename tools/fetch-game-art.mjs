/**
 * Pulls each shipped title's store artwork down into public/media/games/.
 *
 * Both stores put the app icon in the page's og:image, which is the only piece
 * of either page that is stable enough to scrape - the rest is generated markup
 * that changes between visits. Play serves through a resizing CDN, so the
 * request asks for a square at a size the book page can actually use.
 *
 *   node tools/fetch-game-art.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve('public/media/games')

const GAMES = [
  { slug: 'realistic-hajwala', url: 'https://play.google.com/store/apps/details?id=com.TazigraLLC.RealisticHajwala&hl=en' },
  { slug: 'gravity-grid', url: 'https://play.google.com/store/apps/details?id=com.tazigra.gravitygrid&hl=en' },
  { slug: 'word-shift', url: 'https://play.google.com/store/apps/details?id=com.tazigra.wordshift&hl=en' },
  { slug: 'highway-drifter-online', url: 'https://play.google.com/store/apps/details?id=com.madboxgames.drifter&hl=en' },
  { slug: 'highway-drifter-mobile', url: 'https://play.google.com/store/apps/details?id=com.Untitled.CarPhysics&hl=en' },
  { slug: 'amer-fighting', url: 'https://store.steampowered.com/app/3264920/Amer_Fighting/' },
  { slug: 'amer-chase', url: 'https://play.google.com/store/apps/details?id=io.madhook.ameradventures&hl=en' },
  { slug: 'amer-tycoon', url: 'https://play.google.com/store/apps/details?id=io.madhook.karakboy&hl=en' },
  { slug: 'amer-cop-pursuit', url: 'https://play.google.com/store/apps/details?id=com.madboxgames.thechase&hl=en' },
  { slug: 'rooftop-run', url: 'https://play.google.com/store/apps/details?id=io.madhook.parkour&hl=en' },
]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

/** Play's CDN takes size directives after an `=`; ask for a plain square. */
function normalise(src) {
  if (!src.includes('play-lh.googleusercontent.com')) return src
  return src.replace(/=[^=]*$/, '') + '=w512-h512'
}

async function ogImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  const meta =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)

  if (!meta) throw new Error('no og:image')
  return normalise(meta[1].replace(/&amp;/g, '&'))
}

await mkdir(OUT, { recursive: true })

for (const g of GAMES) {
  try {
    const src = await ogImage(g.url)
    const img = await fetch(src, { headers: { 'User-Agent': UA } })
    if (!img.ok) throw new Error(`image HTTP ${img.status}`)

    const type = img.headers.get('content-type') ?? ''
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
    const file = path.join(OUT, `${g.slug}.${ext}`)

    await writeFile(file, Buffer.from(await img.arrayBuffer()))
    console.log(`${g.slug}  ->  ${path.relative(process.cwd(), file)}`)
  } catch (e) {
    console.log(`${g.slug}  --  FAILED: ${e.message}`)
  }
}
