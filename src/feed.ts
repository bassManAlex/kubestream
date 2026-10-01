// Emits events at the configured rate, keeps the last 2000 for GET /events
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

// As many as the viewer shows: a client further behind than this gets at
// least a full list of consecutive events, so the lost ones would have left
// the list anyway and no hole shows (events.test.ts checks the two match).
export const BUFFER_CAPACITY = 2000;
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
  // starts from the oldest buffered event and sets gap: what came between
  // the cursor and that event is gone. With nothing buffered yet there is
  // no page to flag, so gap waits for the first event.
  read(
    since: string | undefined,
    limit: number,
  ): { page: Delivery[]; gap: boolean } {
    if (!since) {
      const start = Math.max(0, this.buffer.length - limit);
      return { page: this.buffer.slice(start, start + limit), gap: false };
    }
    const index = this.buffer.findIndex((delivery) => delivery.id === since);
    const page = this.buffer.slice(index + 1, index + 1 + limit);
    return { page, gap: index === -1 && page.length > 0 };
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
