import type { ConnectionStatus, EventsResponse, ParsedEvent } from "../types";
import { EventsResponseSchema } from "../types";
import { parseEvent } from "../utils/parseEvent";

const CATCHUP_LIMIT = 100;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
// consecutive failures before the badge goes from Reconnecting to Disconnected
const DISCONNECT_AFTER_ATTEMPTS = 4;

export interface EventStreamHandlers {
  onStatus: (status: ConnectionStatus) => void;
  onEvents: (batch: ParsedEvent[]) => void;
  onCursor: (id: string) => void;
  isPaused: () => boolean;
}

// id is the SSE id, usable as `since` even when the event is malformed
interface Delivery {
  event: ParsedEvent;
  id: string | null;
}

// Owns the SSE connection: reconnect with backoff, REST catch-up, one batch
// per animation frame, and the cursor. useEventStream just wires it to
// dispatch.
export class EventStreamClient {
  private es: EventSource | null = null;
  private open = false;
  private cursor: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private pending: Delivery[] = [];
  // the catch-up in flight, shared so at most one runs at a time
  private catchUpRun: Promise<void> | null = null;
  // ids delivered by the catch-up in flight, to drop their live duplicates
  private delivered = new Set<string>();
  // bumped on each connect, so a stale catch-up is ignored
  private generation = 0;
  private attempts = 0;
  private stopped = false;
  private readonly baseUrl: string;
  private readonly handlers: EventStreamHandlers;

  constructor(
    baseUrl: string,
    handlers: EventStreamHandlers,
    initialCursor: string | null = null,
  ) {
    this.baseUrl = baseUrl;
    this.handlers = handlers;
    this.cursor = initialCursor;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.open = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.reconnectTimer = null;
    this.rafId = null;
    this.es?.close();
    this.es = null;
  }

  // After a pause: backfill from the frozen cursor. When disconnected the
  // next onopen does it anyway.
  resume(): void {
    if (this.stopped || !this.open || this.catchUpRun) return;
    void this.catchUp();
  }

  private setCursor(id: string): void {
    this.cursor = id;
    this.handlers.onCursor(id);
  }

  // Commits buffered live events and moves the cursor. Waits while a catch-up
  // runs (it flushes at the end). Paused: the batch is dropped and the cursor
  // stays, so resume() can backfill.
  private flush = (): void => {
    this.rafId = null;
    if (this.stopped || this.catchUpRun) return;
    const batch = this.pending;
    if (batch.length === 0) return;
    this.pending = [];
    if (this.handlers.isPaused()) return;
    this.handlers.onEvents(batch.map((d) => d.event));
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const id = batch[i]?.id;
      if (id) {
        this.setCursor(id);
        break;
      }
    }
  };

  private scheduleFlush(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.flush);
  }

  private async fetchPage(query: string): Promise<EventsResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/events?${query}`);
      if (!res.ok) return null;
      const parsed = EventsResponseSchema.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  // cursor = nextCursor, so trailing malformed events aren't fetched again
  private applyPage({ events, nextCursor }: EventsResponse): void {
    const last = events.length - 1;
    const batch = events.map((raw, i) =>
      parseEvent(raw, i === last ? (nextCursor ?? undefined) : undefined),
    );
    for (const p of batch)
      this.delivered.add(p.status === "ok" ? p.data.id : p.id);
    this.handlers.onEvents(batch);
    if (nextCursor) this.setCursor(nextCursor);
  }

  private catchUp(): Promise<void> {
    if (this.catchUpRun) return this.catchUpRun;
    const gen = this.generation;
    const run = this.drain(gen)
      .catch(() => false)
      .then((complete) => {
        if (gen !== this.generation) return; // connect() already reset the state
        this.catchUpRun = null;
        // a page failed: committing the live events now would skip the gap,
        // so drop them and reconnect
        if (!complete) {
          this.pending = [];
          return this.fail();
        }
        this.attempts = 0;
        this.dropDelivered();
        this.flush();
      });
    this.catchUpRun = run;
    return run;
  }

  // Latest page if there is no cursor yet, otherwise every page after it.
  // Stops on stop(), reconnect or pause (cursor unchanged, resume() refetches).
  // false = a page after the cursor could not be fetched.
  private async drain(gen: number): Promise<boolean> {
    const live = () =>
      !this.stopped && gen === this.generation && !this.handlers.isPaused();
    if (!live()) return true;
    if (!this.cursor) {
      // no cursor means no gap: a failed fetch just means less history
      const json = await this.fetchPage(`limit=${CATCHUP_LIMIT}`);
      if (json && live() && json.events.length > 0) this.applyPage(json);
      return true;
    }
    while (this.cursor && live()) {
      const since = this.cursor;
      const json = await this.fetchPage(
        `since=${since}&limit=${CATCHUP_LIMIT}`,
      );
      if (!json) return false;
      if (!live() || json.events.length === 0) return true;
      this.applyPage(json);
      // the server echoes the input cursor when there is nothing newer
      if (!json.nextCursor || json.nextCursor === since) return true;
    }
    return true;
  }

  // Pages and live events are both in server order, so everything up to the
  // last live event a page already delivered is a duplicate (malformed too).
  private dropDelivered(): void {
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const id = this.pending[i]?.id;
      if (id && this.delivered.has(id)) {
        this.pending = this.pending.slice(i + 1);
        break;
      }
    }
    this.delivered.clear();
  }

  private connect(): void {
    this.es?.close();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.generation += 1;
    this.open = false;
    this.pending = [];
    this.catchUpRun = null;
    this.delivered.clear();

    // retries keep the Reconnecting/Disconnected badge
    if (this.attempts === 0) this.handlers.onStatus("connecting");

    const es = new EventSource(`${this.baseUrl}/events/stream`);
    this.es = es;

    es.onopen = () => {
      if (this.stopped) return;
      this.open = true;
      this.handlers.onStatus("connected");
      // backoff resets after a successful catch-up, not here
      if (this.handlers.isPaused()) {
        this.attempts = 0;
        return;
      }
      void this.catchUp();
    };

    es.onmessage = (e) => {
      if (this.stopped || this.handlers.isPaused()) return;
      const event = parseEvent(e.data, e.lastEventId);
      const id =
        e.lastEventId || (event.status === "ok" ? event.data.id : null);
      this.pending.push({ event, id });
      if (!this.catchUpRun) this.scheduleFlush();
    };

    es.onerror = () => this.fail();
  }

  private fail(): void {
    this.es?.close();
    this.es = null;
    this.open = false;
    if (this.stopped) return;
    this.attempts += 1;
    this.handlers.onStatus(
      this.attempts >= DISCONNECT_AFTER_ATTEMPTS
        ? "disconnected"
        : "reconnecting",
    );
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (this.attempts - 1),
      RECONNECT_MAX_MS,
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
