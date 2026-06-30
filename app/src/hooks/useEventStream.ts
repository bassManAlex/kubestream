import { useEffect, useRef, useCallback } from "react";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import type { EventsResponse, ParsedEvent } from "../types";
import { ConnectionStatus as CS } from "../types";
import { parseEvent } from "../utils/parseEvent";

// "" keeps requests relative so the Vite proxy (and any real deployment)
// applies; override with VITE_SERVER_URL when the API is on another origin.
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";
const CATCHUP_LIMIT = 100;
const RECONNECT_DELAY_MS = 3000;

export function useEventStream(
  state: EventsState,
  dispatch: React.Dispatch<EventsAction>,
) {
  const esRef = useRef<EventSource | null>(null);
  const cursorRef = useRef<string | null>(state.cursor);
  const pausedRef = useRef<boolean>(state.paused);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catchingUpRef = useRef<boolean>(false);
  const pendingRef = useRef<ParsedEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cursorRef.current = state.cursor;
  }, [state.cursor]);

  useEffect(() => {
    pausedRef.current = state.paused;
  }, [state.paused]);

  const ingest = useCallback(
    (batch: ParsedEvent[]) => {
      if (batch.length === 0) return;
      dispatch({ type: "EVENTS_RECEIVED", payload: batch });
      // Advance the cursor to the newest ok event in the batch. Never while
      // paused: freezing the cursor at the last shown event means a reconnect
      // during a pause can still backfill from there instead of skipping it.
      if (pausedRef.current) return;
      for (let i = batch.length - 1; i >= 0; i -= 1) {
        const p = batch[i];
        if (p?.status === "ok") {
          cursorRef.current = p.data.id;
          dispatch({ type: "CURSOR_UPDATED", payload: p.data.id });
          break;
        }
      }
    },
    [dispatch],
  );

  // Flushes everything buffered since the last animation frame in a single
  // dispatch. At ludicrous rate this collapses ~60 dispatches/s into ~1 per
  // frame, each carrying the whole batch instead of one event at a time.
  const flush = useCallback(() => {
    rafRef.current = null;
    const batch = pendingRef.current;
    if (batch.length === 0) return;
    pendingRef.current = [];
    ingest(batch);
  }, [ingest]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // Fills the gap after a (re)connect: an initial page when we have no cursor,
  // otherwise drains every page newer than the cursor before live takes over.
  const catchUp = useCallback(async () => {
    const fetchPage = async (
      query: string,
    ): Promise<EventsResponse | null> => {
      try {
        const res = await fetch(`${SERVER_URL}/events?${query}`);
        if (!res.ok) return null;
        return (await res.json()) as EventsResponse;
      } catch {
        return null; // server still down; SSE onerror will retry
      }
    };

    if (!cursorRef.current) {
      const json = await fetchPage(`limit=${CATCHUP_LIMIT}`);
      if (!json) return;
      ingest(json.events?.map(parseEvent) ?? []);
      return;
    }

    while (cursorRef.current) {
      const since = cursorRef.current;
      const json = await fetchPage(`since=${since}&limit=${CATCHUP_LIMIT}`);
      if (!json) return;
      ingest(json.events?.map(parseEvent) ?? []);
      // The server echoes the input cursor when there is nothing newer.
      if (!json.nextCursor || json.nextCursor === since) break;
    }
  }, [ingest]);

  const connect = useCallback(() => {
    esRef.current?.close();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = [];
    catchingUpRef.current = false;

    dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Connecting });

    const es = new EventSource(`${SERVER_URL}/events/stream`);
    esRef.current = es;

    es.onopen = () => {
      dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Connected });
      if (pausedRef.current) return;
      catchingUpRef.current = true;
      void catchUp().finally(() => {
        catchingUpRef.current = false;
        // Flush events buffered during catch-up, after the gap events, so the
        // array stays in chronological (oldest -> newest) order.
        flush();
      });
    };

    es.onmessage = (e) => {
      if (pausedRef.current) return;
      pendingRef.current.push(parseEvent(e.data));
      // Hold live events while catching up; flush() in onopen drains them once
      // the gap is filled. Otherwise coalesce into the next animation frame.
      if (!catchingUpRef.current) scheduleFlush();
    };

    es.onerror = () => {
      dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Reconnecting });
      es.close();
      esRef.current = null;
      reconnectRef.current = setTimeout(
        () => connectRef.current?.(),
        RECONNECT_DELAY_MS,
      );
    };
  }, [catchUp, dispatch, flush, scheduleFlush]);

  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      esRef.current?.close();
    };
  }, [connect]);
}
