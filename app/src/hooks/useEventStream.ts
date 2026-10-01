import { useEffect, useRef } from "react";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import { EventStreamClient } from "../services/eventStream";
import { SERVER_URL } from "../config/serverUrl";

export function useEventStream(
  state: EventsState,
  dispatch: React.Dispatch<EventsAction>,
  // undefined while the snapshot loads; we wait so the catch-up starts from
  // the saved cursor
  initialCursor: string | null | undefined,
) {
  // pause state goes through a ref, so the client is created only once
  const pausedRef = useRef<boolean>(state.paused);
  const clientRef = useRef<EventStreamClient | null>(null);

  // unpausing backfills what was dropped meanwhile
  useEffect(() => {
    const wasPaused = pausedRef.current;
    pausedRef.current = state.paused;
    if (wasPaused && !state.paused) clientRef.current?.resume();
  }, [state.paused]);

  useEffect(() => {
    if (initialCursor === undefined) return;
    const client = new EventStreamClient(
      SERVER_URL,
      {
        onStatus: (status) =>
          dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: status }),
        onEvents: (batch) =>
          dispatch({ type: "EVENTS_RECEIVED", payload: batch }),
        onCursor: (id) => dispatch({ type: "CURSOR_UPDATED", payload: id }),
        isPaused: () => pausedRef.current,
      },
      initialCursor,
    );
    clientRef.current = client;
    client.start();
    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [dispatch, initialCursor]);
}
