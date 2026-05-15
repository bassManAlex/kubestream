// 1-second tick loop. each tick decides how many events to emit (poisson
// around the configured rate, with occasional spikes) and fans them out
// to live subscribers + the ring buffer + stdout.

import { buildEvent, serialize, type LogEvent } from './events.ts'
import { get as getConfig, type Rate } from './config.ts'

// rate modes map to an internal events-per-minute target
const RATE_EPM: Record<Rate, number> = {
  slow: 60, // 60/min (~1/s mean); calmer stream, still Poisson-jittered
  medium: 600, // 600/min (~10/s mean); default
  fast: 1800, // 1800/min (~30/s mean); busy cluster
  ludicrous: 3600, // 3600/min (~60/s mean); heavy load / incident-style
}

export type BufferedEvent = {
  id: string
  seq: number
  payload: string
}

type Subscriber = (e: BufferedEvent) => void

const BUFFER_SIZE = 1000
const TICK_MS = 1000
const SPIKE_MULTIPLIER = 10

// knuth for small lambda, gaussian approximation for large
function poisson(lambda: number): number {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian()))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k += 1
    p *= Math.random()
  } while (p > L)
  return k - 1
}

function gaussian(): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export class Generator {
  private buffer: BufferedEvent[] = []
  private seq = 0
  private subscribers = new Set<Subscriber>()
  private timer: NodeJS.Timeout | null = null

  start(): void {
    if (this.timer) return
    // emit one event immediately so consumers see something without waiting
    // for the first tick (or for a lull/poisson roll to land on 0)
    this.emitOne()
    this.scheduleTick()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  getRecent(limit: number): BufferedEvent[] {
    const n = Math.min(limit, this.buffer.length)
    return this.buffer.slice(this.buffer.length - n)
  }

  // setTimeout (not setInterval) so a slow tick can't queue overlapping work
  private scheduleTick(): void {
    this.timer = setTimeout(() => {
      try {
        this.tick()
      } finally {
        this.scheduleTick()
      }
    }, TICK_MS)
  }

  private tick(): void {
    const cfg = getConfig()
    const base = RATE_EPM[cfg.rate] / 60
    const isSpike = Math.random() < cfg.spikeProbability
    const count = isSpike ? Math.max(1, Math.round(base * SPIKE_MULTIPLIER)) : poisson(base)

    for (let i = 0; i < count; i += 1) this.emitOne()
  }

  private emitOne(): void {
    const cfg = getConfig()
    const event: LogEvent = buildEvent()
    // serialize() may return a deliberately-broken json string
    const payload = serialize(event, cfg.malformedProbability)
    this.publish(event.id, payload)
  }

  private publish(id: string, payload: string): void {
    this.seq += 1
    const buffered: BufferedEvent = { id, seq: this.seq, payload }
    this.buffer.push(buffered)
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - BUFFER_SIZE)
    }
    // mirror to stdout — exactly what's on the wire, malformed included
    console.log(payload + '\n')
    for (const sub of this.subscribers) {
      try {
        sub(buffered)
      } catch {
        // one broken subscriber must not poison the fan-out
      }
    }
  }
}
