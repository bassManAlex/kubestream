// Emits events at the configured rate, keeps the last 1000 for GET /events
// and pushes each one to the SSE subscribers. It outlives the listener, so
// ids and buffer survive simulated restarts.

import { buildEvent } from "./catalog.ts";
import { corrupt } from "./corrupt.ts";
import { get as getConfig, type Rate } from "./config.ts";

export interface Delivery {
  id: string;
  payload: string;
}

export const EVENTS_PER_SECOND: Record<Rate, number> = {
  slow: 1,
  medium: 10,
  fast: 30,
  ludicrous: 60,
};

export const BUFFER_CAPACITY = 1000;
const TICK_MS = 200;
const TICKS_PER_SECOND = 1000 / TICK_MS;
const BURST_FACTOR = 10;

// Poisson arrivals in one tick. Knuth's method is O(mean) and underflows
// around 700 (bursts reach 600), so large means use a normal approximation.
function arrivals(mean: number): number {
  if (mean > 30) {
    const u = 1 - Math.random();
    const gauss =
      Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss));
  }
  const limit = Math.exp(-mean);
  let count = 0;
  let product = Math.random();
  while (product > limit) {
    count += 1;
    product *= Math.random();
  }
  return count;
}

export class EventFeed {
  private readonly buffer: Delivery[] = [];
  private readonly subscribers = new Set<(delivery: Delivery) => void>();
  // so a cursor saved before a real restart never matches a new id
  private readonly boot = Date.now().toString(36);
  private sequence = 0;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.emit();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(listener: (delivery: Delivery) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  // Oldest first. An unknown cursor (evicted, or from another process)
  // starts from the oldest buffered event.
  read(since: string | undefined, limit: number): Delivery[] {
    const start = since
      ? this.buffer.findIndex((delivery) => delivery.id === since) + 1
      : Math.max(0, this.buffer.length - limit);
    return this.buffer.slice(start, start + limit);
  }

  emit(): Delivery {
    this.sequence += 1;
    const id = `${this.boot}-${this.sequence}`;
    const json = JSON.stringify(buildEvent(id));
    const broken = Math.random() < getConfig().malformedProbability;
    const delivery = { id, payload: broken ? corrupt(json) : json };

    this.buffer.push(delivery);
    if (this.buffer.length > BUFFER_CAPACITY) this.buffer.shift();
    for (const listener of this.subscribers) {
      try {
        listener(delivery);
      } catch {
        // a failing subscriber must not stop delivery to the others
      }
    }
    return delivery;
  }

  private tick(): void {
    const { rate, spikeProbability } = getConfig();
    let mean = EVENTS_PER_SECOND[rate] / TICKS_PER_SECOND;
    if (Math.random() < spikeProbability / TICKS_PER_SECOND) {
      mean *= BURST_FACTOR * TICKS_PER_SECOND; // a full second's burst at once
    }
    const count = arrivals(mean);
    for (let i = 0; i < count; i += 1) this.emit();
  }
}
