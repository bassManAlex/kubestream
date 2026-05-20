import { useReducer, useState } from "react";
import { eventsReducer, initialState } from "./store/eventsReducer";
import { useEventStream } from "./hooks/useEventStream";
import { EventList } from "./components/EventList";
import { EventModal } from "./components/EventModal";
import { Toolbar } from "./components/Toolbar";
import { ConnectionBadge } from "./components/ConnectionBadge";
import type { TypeFilter } from "./types";

export default function App() {
  const [state, dispatch] = useReducer(eventsReducer, initialState);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEventStream(state, dispatch);

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="shrink-0 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-mono font-semibold tracking-widest text-gray-400 uppercase">
            Kubernetes Event Stream
          </h1>
          <span className="text-xs font-mono text-gray-600">
            {state.events.length === 2000
              ? "2000+ events (capped)"
              : `${state.events.length} events`}
          </span>
          {state.malformedCount > 0 && (
            <span className="text-xs font-mono text-red-400/70">
              {state.malformedCount} malformed
            </span>
          )}
        </div>
        <ConnectionBadge status={state.connectionStatus} />
      </header>

      <div className="shrink-0">
        <Toolbar
          filter={state.filter}
          onFilterChange={(f) =>
            dispatch({ type: "FILTER_CHANGED", payload: f })
          }
          paused={state.paused}
          onTogglePause={() => dispatch({ type: "TOGGLE_PAUSE" })}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
      </div>

      <main className="flex-1 min-h-0">
        <EventList
          events={state.events}
          filter={state.filter}
          typeFilter={typeFilter}
          onSelect={(event) =>
            dispatch({ type: "EVENT_SELECTED", payload: event })
          }
        />
      </main>

      {state.selectedEvent && (
        <EventModal
          event={state.selectedEvent}
          uid={state.selectedUid!}
          events={state.events}
          onClose={() => dispatch({ type: "EVENT_CLOSED" })}
          onPrev={() => dispatch({ type: "NAVIGATE_PREV" })}
          onNext={() => dispatch({ type: "NAVIGATE_NEXT" })}
        />
      )}
    </div>
  );
}
