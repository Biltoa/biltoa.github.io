import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FPS_PROFILE_ROUTE = '/__fps-profile'
const FPS_SAMPLE_FLOATS = 5
const FPS_PAYLOAD_HEADER_BYTES = 4
const FPS_HISTOGRAM_STEP_MS = 0.25
const FPS_HISTOGRAM_MAX_MS = 10000
const FPS_HISTOGRAM_BINS = Math.floor(FPS_HISTOGRAM_MAX_MS / FPS_HISTOGRAM_STEP_MS) + 1

interface FpsProfileEvent {
  elapsedMs: number
  frame: number
  category: string
  label: string
  detail: string
  durationMs: number
  severity: 'info' | 'warning' | 'severe' | 'critical'
  usedHeapMb: number | null
}

interface FpsWorstFrame {
  frame: number
  elapsedMs: number
  frameMs: number
  fps: number
}

interface FpsProfileSession {
  csvPath: string
  eventsPath: string
  jsonPath: string
  queue: Promise<void>
  frameCount: number
  eventCount: number
  eventAlerts: { warning: number; severe: number; critical: number }
  elapsedMs: number
  averageMs: number
  worstMs: number
  frameMsSum: number
  framesOver100Ms: number
  framesOver500Ms: number
  framesOver1000Ms: number
  histogram: Uint32Array
  histogramSums: Float64Array
  worstFrames: FpsWorstFrame[]
  environment: Record<string, unknown> | null
}

const frameSeverity = (frameMs: number) =>
  frameMs >= 1000 ? 'critical' : frameMs >= 500 ? 'severe' : frameMs >= 100 ? 'warning' : ''

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

function histogramPercentile(session: FpsProfileSession, percentile: number) {
  const target = Math.max(1, Math.ceil(session.frameCount * percentile))
  let seen = 0
  for (let i = 0; i < session.histogram.length; i++) {
    seen += session.histogram[i]
    if (seen >= target) return i * FPS_HISTOGRAM_STEP_MS
  }
  return 0
}

function slowFractionAverage(session: FpsProfileSession, fraction: number) {
  let remaining = Math.max(1, Math.ceil(session.frameCount * fraction))
  let total = 0
  let count = 0
  for (let i = session.histogram.length - 1; i >= 0 && remaining > 0; i--) {
    const binCount = session.histogram[i]
    if (!binCount) continue
    const take = Math.min(remaining, binCount)
    total += (session.histogramSums[i] / binCount) * take
    count += take
    remaining -= take
  }
  return count > 0 ? total / count : 0
}

/**
 * Local-only sink for the temporary FPS profiler. The browser sends one small
 * binary batch every few seconds; CSV formatting and disk I/O happen here, in
 * the Vite process, rather than stealing time from the render thread.
 */
function fpsProfileRecorder(): Plugin {
  const outputDirectory = join(homedir(), 'Desktop', 'Portfolio FPS Profiles')
  const sessions = new Map<string, FpsProfileSession>()

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST') {
      next()
      return
    }

    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = (requestUrl.searchParams.get('session') ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
    const startFrame = Number.parseInt(requestUrl.searchParams.get('start') ?? '0', 10)
    const ended = requestUrl.searchParams.get('ended') === '1'

    if (!sessionId || !Number.isFinite(startFrame) || startFrame < 0) {
      res.statusCode = 400
      res.end('Invalid FPS profile batch')
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= 1024 * 1024) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > 1024 * 1024) {
        res.statusCode = 413
        res.end('FPS profile batch too large')
        return
      }

      const body = Buffer.concat(chunks)
      let framePayloadOffset = 0
      let events: FpsProfileEvent[] = []
      let environment: Record<string, unknown> | null = null

      if (requestUrl.searchParams.get('format') === '2') {
        if (body.length < FPS_PAYLOAD_HEADER_BYTES) {
          res.statusCode = 400
          res.end('Malformed FPS profile envelope')
          return
        }
        const metadataLength = body.readUInt32LE(0)
        framePayloadOffset = FPS_PAYLOAD_HEADER_BYTES + metadataLength
        if (framePayloadOffset > body.length) {
          res.statusCode = 400
          res.end('Malformed FPS profile metadata')
          return
        }

        try {
          const metadata = JSON.parse(
            body.subarray(FPS_PAYLOAD_HEADER_BYTES, framePayloadOffset).toString('utf8'),
          ) as { events?: unknown; environment?: unknown }
          if (Array.isArray(metadata.events)) {
            events = metadata.events
              .slice(0, 512)
              .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
              .map((event) => ({
                elapsedMs: Number.isFinite(Number(event.elapsedMs)) ? Math.max(0, Number(event.elapsedMs)) : 0,
                frame: Number.isFinite(Number(event.frame)) ? Math.max(0, Math.floor(Number(event.frame))) : 0,
                category: String(event.category ?? 'app').slice(0, 48),
                label: String(event.label ?? 'event').slice(0, 96),
                detail: String(event.detail ?? '').slice(0, 512),
                durationMs: Number.isFinite(Number(event.durationMs))
                  ? Math.max(0, Number(event.durationMs))
                  : 0,
                severity: ['info', 'warning', 'severe', 'critical'].includes(String(event.severity))
                  ? (String(event.severity) as FpsProfileEvent['severity'])
                  : 'info',
                usedHeapMb: Number.isFinite(Number(event.usedHeapMb)) ? Number(event.usedHeapMb) : null,
              }))
          }
          if (metadata.environment && typeof metadata.environment === 'object') {
            environment = metadata.environment as Record<string, unknown>
          }
        } catch {
          res.statusCode = 400
          res.end('Invalid FPS profile metadata')
          return
        }
      }

      const framePayloadLength = body.length - framePayloadOffset
      if (framePayloadLength % (FPS_SAMPLE_FLOATS * Float32Array.BYTES_PER_ELEMENT) !== 0) {
        res.statusCode = 400
        res.end('Malformed FPS profile batch')
        return
      }

      void (async () => {
        await mkdir(outputDirectory, { recursive: true })

        let session = sessions.get(sessionId)
        if (!session) {
          const csvPath = join(outputDirectory, `portfolio-fps-${sessionId}.csv`)
          const eventsPath = join(outputDirectory, `portfolio-fps-${sessionId}-events.csv`)
          const jsonPath = join(outputDirectory, `portfolio-fps-${sessionId}-summary.json`)
          session = {
            csvPath,
            eventsPath,
            jsonPath,
            queue: Promise.all([
              writeFile(
                csvPath,
                'frame,elapsed_ms,frame_ms,fps,running_avg_ms,running_avg_fps,running_worst_ms,page_hidden,stall_level\n',
                'utf8',
              ),
              writeFile(
                eventsPath,
                'event,elapsed_ms,frame,category,label,duration_ms,severity,detail,used_heap_mb\n',
                'utf8',
              ),
            ]).then(() => undefined),
            frameCount: 0,
            eventCount: 0,
            eventAlerts: { warning: 0, severe: 0, critical: 0 },
            elapsedMs: 0,
            averageMs: 0,
            worstMs: 0,
            frameMsSum: 0,
            framesOver100Ms: 0,
            framesOver500Ms: 0,
            framesOver1000Ms: 0,
            histogram: new Uint32Array(FPS_HISTOGRAM_BINS),
            histogramSums: new Float64Array(FPS_HISTOGRAM_BINS),
            worstFrames: [],
            environment,
          }
          sessions.set(sessionId, session)
        } else if (environment) {
          session.environment = environment
        }

        const sampleCount = framePayloadLength / (FPS_SAMPLE_FLOATS * Float32Array.BYTES_PER_ELEMENT)
        const rows: string[] = new Array(sampleCount)

        for (let i = 0; i < sampleCount; i++) {
          const offset = framePayloadOffset + i * FPS_SAMPLE_FLOATS * Float32Array.BYTES_PER_ELEMENT
          const elapsedMs = body.readFloatLE(offset)
          const frameMs = body.readFloatLE(offset + 4)
          const averageMs = body.readFloatLE(offset + 8)
          const worstMs = body.readFloatLE(offset + 12)
          const hidden = body.readFloatLE(offset + 16) > 0 ? 1 : 0
          const fps = frameMs > 0 ? 1000 / frameMs : 0
          const averageFps = averageMs > 0 ? 1000 / averageMs : 0
          const severity = frameSeverity(frameMs)
          const frame = startFrame + i

          rows[i] = `${frame},${elapsedMs.toFixed(3)},${frameMs.toFixed(3)},${fps.toFixed(2)},${averageMs.toFixed(3)},${averageFps.toFixed(2)},${worstMs.toFixed(3)},${hidden},${severity}\n`
          session.frameCount = Math.max(session.frameCount, frame + 1)
          session.elapsedMs = Math.max(session.elapsedMs, elapsedMs)
          session.averageMs = averageMs
          session.worstMs = Math.max(session.worstMs, worstMs)
          session.frameMsSum += frameMs
          if (frameMs >= 100) session.framesOver100Ms++
          if (frameMs >= 500) session.framesOver500Ms++
          if (frameMs >= 1000) session.framesOver1000Ms++
          const bin = Math.min(
            session.histogram.length - 1,
            Math.max(0, Math.floor(frameMs / FPS_HISTOGRAM_STEP_MS)),
          )
          session.histogram[bin]++
          session.histogramSums[bin] += frameMs
          session.worstFrames.push({ frame, elapsedMs, frameMs, fps })
          session.worstFrames.sort((a, b) => b.frameMs - a.frameMs)
          if (session.worstFrames.length > 20) session.worstFrames.length = 20
        }

        const eventRows = events.map((event, index) =>
          [
            session.eventCount + index,
            event.elapsedMs.toFixed(3),
            event.frame,
            csvCell(event.category),
            csvCell(event.label),
            event.durationMs.toFixed(3),
            event.severity,
            csvCell(event.detail),
            event.usedHeapMb === null ? '' : event.usedHeapMb.toFixed(3),
          ].join(',') + '\n',
        )
        session.eventCount += events.length
        for (const event of events) {
          if (event.severity !== 'info') session.eventAlerts[event.severity]++
        }

        session.queue = session.queue.then(async () => {
          if (rows.length) await appendFile(session.csvPath, rows.join(''), 'utf8')
          if (eventRows.length) await appendFile(session.eventsPath, eventRows.join(''), 'utf8')
          if (ended) {
            const meanFrameMs = session.frameCount > 0 ? session.frameMsSum / session.frameCount : 0
            const onePercentLowMs = slowFractionAverage(session, 0.01)
            await writeFile(
              session.jsonPath,
              `${JSON.stringify(
                {
                  sessionId,
                  frames: session.frameCount,
                  events: session.eventCount,
                  eventAlerts: session.eventAlerts,
                  durationSeconds: Number((session.elapsedMs / 1000).toFixed(3)),
                  averageFps: Number((meanFrameMs > 0 ? 1000 / meanFrameMs : 0).toFixed(2)),
                  averageFrameMs: Number(meanFrameMs.toFixed(3)),
                  onePercentLowFps: Number(
                    (onePercentLowMs > 0 ? 1000 / onePercentLowMs : 0).toFixed(2),
                  ),
                  percentilesFrameMs: {
                    p50: Number(histogramPercentile(session, 0.5).toFixed(3)),
                    p95: Number(histogramPercentile(session, 0.95).toFixed(3)),
                    p99: Number(histogramPercentile(session, 0.99).toFixed(3)),
                    p999: Number(histogramPercentile(session, 0.999).toFixed(3)),
                  },
                  worstFrameMs: Number(session.worstMs.toFixed(3)),
                  slowFrames: {
                    over100Ms: session.framesOver100Ms,
                    over500Ms: session.framesOver500Ms,
                    over1000Ms: session.framesOver1000Ms,
                  },
                  worstFrames: session.worstFrames.map((frame) => ({
                    frame: frame.frame,
                    elapsedSeconds: Number((frame.elapsedMs / 1000).toFixed(3)),
                    frameMs: Number(frame.frameMs.toFixed(3)),
                    fps: Number(frame.fps.toFixed(2)),
                  })),
                  environment: session.environment,
                  csv: session.csvPath,
                  eventsCsv: session.eventsPath,
                },
                null,
                2,
              )}\n`,
              'utf8',
            )
          }
        })
        await session.queue

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ savedTo: session.csvPath, eventsSavedTo: session.eventsPath }))
        if (ended) sessions.delete(sessionId)
      })().catch((error: unknown) => {
        console.error('[fps-profile-recorder]', error)
        res.statusCode = 500
        res.end('Could not save FPS profile')
      })
    })
  }

  return {
    name: 'local-fps-profile-recorder',
    configureServer(server) {
      server.middlewares.use(FPS_PROFILE_ROUTE, handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(FPS_PROFILE_ROUTE, handler)
    },
  }
}

/**
 * Unity's current `.unityweb` payloads carry Brotli's Unity marker. Without
 * these headers the loader falls back to its bundled JavaScript decompressor,
 * moving hundreds of megabytes through a worker before WebAssembly can start.
 */
function unityBuildHeaders(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!pathname.startsWith('/unity/Build/') || !pathname.endsWith('.unityweb')) {
      next()
      return
    }

    res.setHeader('Content-Encoding', 'br')
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('Cache-Control', 'public, max-age=3600')

    if (pathname.endsWith('.wasm.unityweb')) {
      res.setHeader('Content-Type', 'application/wasm')
    } else if (pathname.endsWith('.framework.js.unityweb')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    } else {
      res.setHeader('Content-Type', 'application/octet-stream')
    }
    next()
  }

  return {
    name: 'unity-build-response-headers',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// base '/' — deploying to the root of ahmadbilto.com.
// If this ever moves to a GitHub Pages project repo, set base: '/repo-name/'.
export default defineConfig({
  base: '/',
  plugins: [unityBuildHeaders(), react()],
  server: {
    port: 5173,
    open: true,
    headers: {
      // Unity WebGL builds that use threads need these. Harmless otherwise.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/')

          // Keep Vite's shared dynamic-import helper on the lightweight app
          // side of the graph instead of letting Rollup attach it to R3F.
          if (modulePath.includes('vite/preload-helper')) {
            return 'react'
          }

          if (
            /\/node_modules\/(?:react|react-dom|react-router|react-router-dom|scheduler)\//.test(
              modulePath,
            )
          ) {
            return 'react'
          }

          if (/\/node_modules\/@react-three\/(?:fiber|drei)\//.test(modulePath)) {
            return 'r3f'
          }

          if (/\/node_modules\/three\//.test(modulePath)) {
            return 'three'
          }
        },
      },
    },
  },
})
