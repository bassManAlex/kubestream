import { useEffect, useRef, useCallback } from "react";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import { ConnectionStatus as CS } from "../types";
import { parseEvent } from "../utils/parseEvent";

const SERVER_URL = "http://localhost:4000";
const CATCHUP_LIMIT = 100;

export function useEventStream(
  state: EventsState,
  dispatch: React.Dispatch<EventsAction>,
) {
  const esRef = useRef<EventSource | null>(null);
  const cursorRef = useRef<string | null>(state.cursor);

  useEffect(() => {
    cursorRef.current = state.cursor;
  }, [state.cursor]);

  const catchUp = useCallback(async () => {
    if (!cursorRef.current) return;
    try {
      const url = `${SERVER_URL}/events?since=${cursorRef.current}&limit=${CATCHUP_LIMIT}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (json.events?.length > 0) {
        dispatch({
          type: "EVENTS_RECEIVED",
          payload: json.events.map(parseEvent),
        });
      }
      if (json.nextCursor) {
        dispatch({ type: "CURSOR_UPDATED", payload: json.nextCursor });
      }
    } catch {
      // server still down, SSE will retry
    }
  }, [dispatch]);

  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();

    dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Connecting });

    const es = new EventSource(`${SERVER_URL}/events/stream`);
    esRef.current = es;

    es.onopen = () => {
      dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Connected });
      catchUp();
    };

    es.onmessage = (e) => {
      const parsed = parseEvent(e.data);
      dispatch({ type: "EVENTS_RECEIVED", payload: [parsed] });
      if (parsed.status === "ok") {
        dispatch({ type: "CURSOR_UPDATED", payload: parsed.data.id });
      }
    };

    es.onerror = () => {
      dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: CS.Reconnecting });
      es.close();
      esRef.current = null;
      setTimeout(() => connectRef.current?.(), 3000);
    };
  }, [catchUp, dispatch]);

  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);
}
