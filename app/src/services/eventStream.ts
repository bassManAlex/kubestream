import type { ConnectionStatus, ParsedEvent } from "../types";
import { ConnectionStatus as CS, EventsResponseSchema } from "../types";
import { parseEvent } from "../utils/parseEvent";

const CATCHUP_LIMIT = 100;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
// after this many consecutive failed reconnects, report Disconnected (red)
// instead of the transient Reconnecting state.
const DISCONNECT_AFTER_ATTEMPTS = 4;

export interface EventStreamHandlers {
  onStatus: (status: ConnectionStatus) => void;
  onEvents: (batch: ParsedEvent[]) => void;
  onCursor: (id: string) => void;
  isPaused: () => boolean;
}

// Framework-agnostic owner of the SSE connection: reconnect/backoff, REST
// catch-up, animation-frame batching, and the cursor all live here. The React
// hook is a thin adapter that wires these callbacks to a dispatch.
export class EventStreamClient {
  private es: EventSource | null = null;
  private cursor: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private pending: ParsedEvent[] = [];
  private catchingUp = false;
  private attempts = 0;
  private stopped = false;
  private readonly baseUrl: string;
  private readonly handlers: EventStreamHandlers;

  constructor(baseUrl: string, handlers: EventStreamHandlers) {
    this.baseUrl = baseUrl;
    this.handlers = handlers;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.reconnectTimer = null;
    this.rafId = null;
    this.es?.close();
    this.es = null;
  }

  // Append a chronological batch and advance the cursor to its newest ok event.
  // Never advances while paused, so a reconnect during a pause can backfill
  // from the last shown event instead of skipping the gap.
  private emit(batch: ParsedEvent[]): void {
    if (batch.length === 0) return;
    this.handlers.onEvents(batch);
    if (this.handlers.isPaused()) return;
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const p = batch[i];
      if (p?.status === "ok") {
        this.cursor = p.data.id;
        this.handlers.onCursor(p.data.id);
        break;
      }
    }
  }

  private flush = (): void => {
    this.rafId = null;
    const batch = this.pending;
    if (batch.length === 0) return;
    this.pending = [];
    this.emit(batch);
  };

  private scheduleFlush(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.flush);
  }

  private async fetchPage(query: string): Promise<{
    events: string[];
    nextCursor: string | null;
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/events?${query}`);
      if (!res.ok) return null;
      const parsed = EventsResponseSchema.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null; // server still down; onerror will retry
    }
  }

  // Fills the gap after a (re)connect: an initial page when we have no cursor,
  // otherwise drains every page newer than the cursor before live takes over.
  private async catchUp(): Promise<void> {
    if (!this.cursor) {
      const json = await this.fetchPage(`limit=${CATCHUP_LIMIT}`);
      if (json) this.emit(json.events.map(parseEvent));
      return;
    }
    while (this.cursor) {
      const since = this.cursor;
      const json = await this.fetchPage(`since=${since}&limit=${CATCHUP_LIMIT}`);
      if (!json) return;
      this.emit(json.events.map(parseEvent));
      // the server echoes the input cursor when there is nothing newer
      if (!json.nextCursor || json.nextCursor === since) break;
    }
  }

  private connect(): void {
    this.es?.close();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pending = [];
    this.catchingUp = false;

    this.handlers.onStatus(CS.Connecting);

    const es = new EventSource(`${this.baseUrl}/events/stream`);
    this.es = es;

    es.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus(CS.Connected);
      if (this.handlers.isPaused()) return;
      this.catchingUp = true;
      void this.catchUp().finally(() => {
        this.catchingUp = false;
        // flush events buffered during catch-up, after the gap, preserving order
        this.flush();
      });
    };

    es.onmessage = (e) => {
      if (this.handlers.isPaused()) return;
      this.pending.push(parseEvent(e.data));
      if (!this.catchingUp) this.scheduleFlush();
    };

    es.onerror = () => {
      es.close();
      this.es = null;
      if (this.stopped) return;
      this.attempts += 1;
      this.handlers.onStatus(
        this.attempts >= DISCONNECT_AFTER_ATTEMPTS
          ? CS.Disconnected
          : CS.Reconnecting,
      );
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** (this.attempts - 1),
        RECONNECT_MAX_MS,
      );
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }
}
