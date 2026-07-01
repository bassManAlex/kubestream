import { useEffect, useRef, useState } from "react";
import type { EventsState } from "../store/eventsReducer";
import { loadSnapshot, saveSnapshot } from "../services/eventStore";

const PERSIST_DEBOUNCE_MS = 1000;

export interface RestoredSnapshot {
  events: EventsState["events"];
  cursor: EventsState["cursor"];
}

// Loads the IndexedDB snapshot once on mount (undefined while pending), and
// debounce-persists state.events/cursor on every change after that. Writes
// are skipped until the initial load resolves, so a fast refresh can't race
// an empty write over a snapshot that hasn't been read yet.
export function usePersistedEvents(state: EventsState) {
  const [restored, setRestored] = useState<RestoredSnapshot | null>();

  useEffect(() => {
    void loadSnapshot().then((snapshot) =>
      setRestored(snapshot ?? { events: [], cursor: null }),
    );
  }, []);

  const loaded = restored !== undefined;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void saveSnapshot({ events: state.events, cursor: state.cursor });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.events, state.cursor, loaded]);

  return restored;
}
