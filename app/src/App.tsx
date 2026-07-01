import { useEffect, useReducer, useRef } from "react";
import { eventsReducer, initialState, MAX_EVENTS } from "./store/eventsReducer";
import { useEventStream } from "./hooks/useEventStream";
import { usePersistedEvents } from "./hooks/usePersistedEvents";
import { EventList } from "./components/EventList";
import { EventModal } from "./components/EventModal";
import { Toolbar } from "./components/Toolbar";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { ErrorBoundary } from "./components/ErrorBoundary";
import logo from "./assets/img/logo.png";

export default function App() {
  const [state, dispatch] = useReducer(eventsReducer, initialState);

  const restored = usePersistedEvents(state);
  const restoredDispatched = useRef(false);
  useEffect(() => {
    if (!restored || restoredDispatched.current) return;
    restoredDispatched.current = true;
    dispatch({ type: "EVENTS_RESTORED", payload: restored });
  }, [restored]);

  useEventStream(state, dispatch, restored?.cursor);

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="shrink-0 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="" className="h-20 object-contain" />
          </div>
          <span className="text-xs font-mono text-gray-600">
            {state.events.length >= MAX_EVENTS
              ? `${MAX_EVENTS}+ events (capped)`
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
          typeFilter={state.typeFilter}
          onTypeFilterChange={(t) =>
            dispatch({ type: "TYPE_FILTER_CHANGED", payload: t })
          }
          namespaces={state.namespaces}
          namespaceFilter={state.namespaceFilter}
          onNamespaceFilterChange={(ns) =>
            dispatch({ type: "NAMESPACE_FILTER_CHANGED", payload: ns })
          }
          reasons={state.reasons}
          reasonFilter={state.reasonFilter}
          onReasonFilterChange={(r) =>
            dispatch({ type: "REASON_FILTER_CHANGED", payload: r })
          }
        />
      </div>

      <ErrorBoundary>
        <main className="flex-1 min-h-0">
          <EventList
            events={state.events}
            filter={state.filter}
            typeFilter={state.typeFilter}
            namespaceFilter={state.namespaceFilter}
            reasonFilter={state.reasonFilter}
            connectionStatus={state.connectionStatus}
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
      </ErrorBoundary>
    </div>
  );
}
