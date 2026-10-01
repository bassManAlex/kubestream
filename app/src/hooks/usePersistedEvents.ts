import { useEffect, useRef, useState } from "react";
import type { EventsState } from "../store/eventsReducer";
import { loadSnapshot, saveSnapshot } from "../services/eventStore";
import type { EventSnapshot } from "../services/eventStore";

const PERSIST_INTERVAL_MS = 1000;

export interface RestoredSnapshot {
  events: EventsState["events"];
  cursor: EventsState["cursor"];
}

interface PersistState {
  // latest snapshot not yet written, null when the store is up to date
  pending: EventSnapshot | null;
  timer: ReturnType<typeof setTimeout> | null;
}

function flush(persist: PersistState) {
  if (persist.timer !== null) clearTimeout(persist.timer);
  persist.timer = null;
  const snapshot = persist.pending;
  if (!snapshot) return;
  persist.pending = null;
  void saveSnapshot(snapshot);
}

// Loads the snapshot on mount (undefined until then), then saves the latest
// state at most once a second, and right away on pagehide, hidden tab and
// unmount. Nothing is written before the load is done, otherwise a quick
// refresh could overwrite the snapshot with an empty one.
export function usePersistedEvents(state: EventsState) {
  const [restored, setRestored] = useState<RestoredSnapshot | null>();

  useEffect(() => {
    void loadSnapshot().then((snapshot) =>
      setRestored(snapshot ?? { events: [], cursor: null }),
    );
  }, []);

  const loaded = restored !== undefined;
  const persistRef = useRef<PersistState>({ pending: null, timer: null });

  useEffect(() => {
    if (!loaded) return;
    const persist = persistRef.current;
    persist.pending = { events: state.events, cursor: state.cursor };
    if (persist.timer === null) {
      persist.timer = setTimeout(() => flush(persist), PERSIST_INTERVAL_MS);
    }
  }, [state.events, state.cursor, loaded]);

  useEffect(() => {
    const persist = persistRef.current;
    const onPageHide = () => flush(persist);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(persist);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush(persist);
    };
  }, []);

  return restored;
}
