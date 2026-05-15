// hono app + routes. the generator is passed in so it survives across
// simulated restarts (the listener cycles, the buffer doesn't).
//
//   GET    /health
//   GET    /events           ring buffer; optional ?since=<id>&limit=
//   GET    /events/stream    sse
//   GET    /events/ws        websocket
//   GET    /config
//   PATCH  /config

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { createNodeWebSocket } from '@hono/node-ws'
import type { Server } from 'node:http'
import { styleText } from 'node:util'
import { Generator, type BufferedEvent } from './generator.ts'
import { get as getConfig, update as updateConfig, type Config } from './config.ts'

const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 100
const HEARTBEAT_MS = 15_000
export const SERVER_ID = 'log-stream-server'

export type BuiltApp = {
  app: Hono
  injectWebSocket: (server: Server) => void
}

export function buildApp(generator: Generator): BuiltApp {
  const app = new Hono()
  // createNodeWebSocket has to wrap the app before the ws route is registered
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.use('*', cors())

  const startedAt = Date.now()

  // x-log-stream-server header lets the tui (or any other client) confirm
  // it's talking to *this* process rather than something unrelated on the
  // same port. value is the package version baked at module load time.
  app.get('/health', (c) => {
    c.header('x-log-stream-server', SERVER_ID)
    return c.json({ ok: true, server: SERVER_ID, uptimeMs: Date.now() - startedAt })
  })

  // ring buffer snapshot. with ?since=<id> we find that id and return only
  // newer entries; if the id is unknown (too old or never existed) we just
  // return what we have, which is the most useful behavior after a long gap.
  app.get('/events', (c) => {
    const since = c.req.query('since')
    const limitRaw = Number(c.req.query('limit') ?? DEFAULT_LIMIT)
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT))

    let entries: BufferedEvent[]
    if (since) {
      const recent = generator.getRecent(MAX_LIMIT)
      const idx = recent.findIndex((e) => e.id === since)
      const after = idx >= 0 ? recent.slice(idx + 1) : recent
      entries = after.slice(0, limit)
    } else {
      entries = generator.getRecent(limit)
    }

    const last = entries[entries.length - 1]
    return c.json({
      events: entries.map((e) => e.payload),
      // echo the input cursor when there's nothing new
      nextCursor: last ? last.id : (since ?? null),
    })
  })

  app.get('/events/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // comment-only heartbeat so proxies don't time out during quiet periods
      const heartbeat = setInterval(() => {
        stream.write(': heartbeat\n\n').catch(() => {})
      }, HEARTBEAT_MS)

      const unsubscribe = generator.subscribe((e) => {
        stream.writeSSE({ id: e.id, data: e.payload }).catch(() => {})
      })

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })
      })
    })
  })

  app.get(
    '/events/ws',
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | null = null

      const cleanup = () => {
        unsubscribe?.()
        unsubscribe = null
      }

      return {
        onOpen: (_evt, ws) => {
          unsubscribe = generator.subscribe((e) => {
            try {
              ws.send(e.payload)
            } catch {
              // close/error handler will clean up
            }
          })
        },
        onClose: cleanup,
        onError: cleanup,
      }
    }),
  )

  app.get('/config', (c) => c.json(getConfig()))

  app.patch('/config', async (c) => {
    let body: Partial<Config>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400)
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be a JSON object' }, 400)
    }
    const before = getConfig()
    const next = await updateConfig(body)
    logConfigChange(before, next)
    return c.json(next)
  })

  app.notFound((c) => c.json({ error: 'not found' }, 404))

  return { app, injectWebSocket }
}

// emits a colored diff to stdout so config changes stand out from the
// flood of event payloads. only logs fields that actually changed.
function logConfigChange(before: Config, after: Config): void {
  const tag = styleText(['bold', 'magenta'], '[config]')
  const diffs: string[] = []
  for (const key of Object.keys(after) as (keyof Config)[]) {
    if (before[key] !== after[key]) {
      const k = styleText('cyan', String(key))
      const from = styleText('red', String(before[key]))
      const to = styleText('green', String(after[key]))
      diffs.push(`${k}: ${from} -> ${to}`)
    }
  }
  if (diffs.length === 0) {
    console.log(`${tag} patch had no effect`)
  } else {
    console.log(`${tag} updated  ${diffs.join('  ')}`)
  }
}
