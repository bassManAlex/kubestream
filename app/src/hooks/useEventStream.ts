import { useEffect, useRef } from "react";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import { EventStreamClient } from "../services/eventStream";

// "" keeps requests relative so the Vite proxy (and any real deployment)
// applies; override with VITE_SERVER_URL when the API is on another origin.
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "";

export function useEventStream(
  state: EventsState,
  dispatch: React.Dispatch<EventsAction>,
) {
  // The client reads liveness (pause state) through a ref so it never needs to
  // be recreated when state changes; it owns the connection for the hook's life.
  const pausedRef = useRef<boolean>(state.paused);
  useEffect(() => {
    pausedRef.current = state.paused;
  }, [state.paused]);

  useEffect(() => {
    const client = new EventStreamClient(SERVER_URL, {
      onStatus: (status) =>
        dispatch({ type: "CONNECTION_STATUS_CHANGED", payload: status }),
      onEvents: (batch) =>
        dispatch({ type: "EVENTS_RECEIVED", payload: batch }),
      onCursor: (id) => dispatch({ type: "CURSOR_UPDATED", payload: id }),
      isPaused: () => pausedRef.current,
    });
    client.start();
    return () => client.stop();
  }, [dispatch]);
}
