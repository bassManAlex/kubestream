import { useEffect, useRef } from "react";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import { EventStreamClient } from "../services/eventStream";
import { SERVER_URL } from "../config/serverUrl";

export function useEventStream(
  state: EventsState,
  dispatch: React.Dispatch<EventsAction>,
  // Cursor restored from persistence, or undefined while it's still loading.
  // The stream waits for this to resolve so catch-up can seed from it instead
  // of starting cold and re-fetching events already on disk.
  initialCursor: string | null | undefined,
) {
  // The client reads liveness (pause state) through a ref so it never needs to
  // be recreated when state changes; it owns the connection for the hook's life.
  const pausedRef = useRef<boolean>(state.paused);
  useEffect(() => {
    pausedRef.current = state.paused;
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
    client.start();
    return () => client.stop();
  }, [dispatch, initialCursor]);
}
