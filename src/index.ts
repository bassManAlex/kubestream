// entry point. starts the generator and runs a lifecycle loop that
// periodically tears the http listener down and brings it back up,
// simulating a redeploy. the generator and config outlive any one
// listener so ring buffer + event ids survive across restarts.

import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { styleText } from 'node:util'
import { load as loadConfig, get as getConfig, type Config } from './config.ts'
import { Generator } from './generator.ts'
import { buildApp } from './server.ts'

const PORT = Number(process.env.PORT ?? 4000)
const RESTART_DOWN_SECONDS = 5

function expRandom(meanSeconds: number): number {
  const u = Math.max(1e-9, Math.random())
  return -Math.log(u) * meanSeconds
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', done)
      resolve()
    }

    const timeout = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function startServer(generator: Generator, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    try {
      const { app, injectWebSocket } = buildApp(generator)
      const server = serve({ fetch: app.fetch, port }, (info) => {
        console.log(`[server] listening on http://localhost:${info.port}`)
        injectWebSocket(server as Server)
        resolve(server as Server)
      })
      server.on('error', reject)
    } catch (err) {
      reject(err)
    }
  })
}

// force-drop existing keep-alive / sse / ws so clients see EOF immediately,
// like a real redeploy. plain server.close() would let them linger.
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

function logStartupConfig(cfg: Config): void {
  const tag = styleText(['bold', 'magenta'], '[config]')
  const parts = (Object.entries(cfg) as [keyof Config, Config[keyof Config]][]).map(
    ([k, v]) => `${styleText('cyan', String(k))}: ${styleText('green', String(v))}`,
  )
  console.log(`${tag} loaded  ${parts.join('  ')}`)
}

async function main(): Promise<void> {
  await loadConfig()
  logStartupConfig(getConfig())

  const generator = new Generator()
  generator.start()

  let shuttingDown = false
  const shutdownController = new AbortController()
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[server] received ${signal}, shutting down`)
    generator.stop()
    shutdownController.abort()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // one iteration = one listener lifetime
  while (!shuttingDown) {
    const server = await startServer(generator, PORT)

    const restartInterval = getConfig().serverRestartIntervalSeconds
    if (restartInterval > 0) {
      const delayMs = expRandom(restartInterval) * 1000
      console.log(`[server] next simulated restart in ${(delayMs / 1000).toFixed(1)}s`)
      await sleep(delayMs, shutdownController.signal)
      if (shuttingDown) {
        await closeServer(server)
        break
      }
      console.log('[server] simulating restart: closing server')
      await closeServer(server)
      console.log(`[server] down for ${RESTART_DOWN_SECONDS}s`)
      await sleep(RESTART_DOWN_SECONDS * 1000, shutdownController.signal)
    } else {
      // restart chaos disabled: hold the listener open until shutdown
      await sleep(Number.MAX_SAFE_INTEGER, shutdownController.signal)
      await closeServer(server)
      break
    }
  }

  generator.stop()
  console.log('[server] bye')
  process.exit(0)
}

main().catch((err) => {
  console.error('[server] fatal', err)
  process.exit(1)
})
