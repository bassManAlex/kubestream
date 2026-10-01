import type {
  KubeEvent,
  ParsedEvent,
  ConnectionStatus,
  TypeFilter,
} from "../types";
import { MAX_EVENTS } from "../types";
import { getUidEvents } from "../utils/siblings";

// null = no filter. Not "all": that is a valid namespace name.
export type FacetFilter = string | null;

export interface EventsState {
  events: ParsedEvent[];
  cursor: string | null;
  connectionStatus: ConnectionStatus;
  filter: string;
  typeFilter: TypeFilter;
  // namespaces and reasons seen so far, for the filter dropdowns
  namespaces: Set<string>;
  reasons: Set<string>;
  namespaceFilter: FacetFilter;
  reasonFilter: FacetFilter;
  selectedEvent: KubeEvent | null;
  selectedUid: string | null;
  paused: boolean;
  malformedCount: number;
  // catch-ups that found the cursor gone, so events were lost
  gapCount: number;
}

export const initialState: EventsState = {
  events: [],
  cursor: null,
  connectionStatus: "connecting",
  filter: "",
  typeFilter: "all",
  namespaces: new Set(),
  reasons: new Set(),
  namespaceFilter: null,
  reasonFilter: null,
  selectedEvent: null,
  selectedUid: null,
  paused: false,
  malformedCount: 0,
  gapCount: 0,
};

export type EventsAction =
  | { type: "EVENTS_RECEIVED"; payload: ParsedEvent[] }
  | {
      type: "EVENTS_RESTORED";
      payload: { events: ParsedEvent[]; cursor: string | null };
    }
  | { type: "CURSOR_UPDATED"; payload: string }
  | { type: "GAP_DETECTED" }
  | { type: "CONNECTION_STATUS_CHANGED"; payload: ConnectionStatus }
  | { type: "FILTER_CHANGED"; payload: string }
  | { type: "TYPE_FILTER_CHANGED"; payload: TypeFilter }
  | { type: "NAMESPACE_FILTER_CHANGED"; payload: FacetFilter }
  | { type: "REASON_FILTER_CHANGED"; payload: FacetFilter }
  | { type: "EVENT_SELECTED"; payload: KubeEvent }
  | { type: "EVENT_CLOSED" }
  | { type: "NAVIGATE_PREV" }
  | { type: "NAVIGATE_NEXT" }
  | { type: "TOGGLE_PAUSE" };

export { MAX_EVENTS };

export function eventsReducer(
  state: EventsState,
  action: EventsAction,
): EventsState {
  switch (action.type) {
    case "EVENTS_RECEIVED": {
      if (state.paused) return state;
      const malformedCount = action.payload.filter(
        (e) => e.status === "malformed",
      ).length;
      // payload is oldest-first, the store newest-first: prepend reversed,
      // trim the tail
      const merged = [...[...action.payload].reverse(), ...state.events];
      const trimmed =
        merged.length > MAX_EVENTS ? merged.slice(0, MAX_EVENTS) : merged;
      const namespaces = new Set(state.namespaces);
      const reasons = new Set(state.reasons);
      for (const e of action.payload) {
        if (e.status !== "ok") continue;
        namespaces.add(e.data.involvedObject.namespace);
        reasons.add(e.data.reason);
      }
      return {
        ...state,
        events: trimmed,
        namespaces,
        reasons,
        malformedCount: state.malformedCount + malformedCount,
      };
    }

    // From IndexedDB: saved newest-first and capped, so used as is. Facets
    // are rebuilt; malformedCount and gapCount only count this session.
    case "EVENTS_RESTORED": {
      const namespaces = new Set<string>();
      const reasons = new Set<string>();
      for (const e of action.payload.events) {
        if (e.status !== "ok") continue;
        namespaces.add(e.data.involvedObject.namespace);
        reasons.add(e.data.reason);
      }
      return {
        ...state,
        events: action.payload.events,
        cursor: action.payload.cursor,
        namespaces,
        reasons,
      };
    }

    case "CURSOR_UPDATED":
      return { ...state, cursor: action.payload };

    case "GAP_DETECTED":
      return { ...state, gapCount: state.gapCount + 1 };

    case "CONNECTION_STATUS_CHANGED":
      return { ...state, connectionStatus: action.payload };

    case "FILTER_CHANGED":
      return { ...state, filter: action.payload };

    case "TYPE_FILTER_CHANGED":
      return { ...state, typeFilter: action.payload };

    case "NAMESPACE_FILTER_CHANGED":
      return { ...state, namespaceFilter: action.payload };

    case "REASON_FILTER_CHANGED":
      return { ...state, reasonFilter: action.payload };

    case "EVENT_SELECTED":
      return {
        ...state,
        selectedEvent: action.payload,
        selectedUid: action.payload.involvedObject.uid,
      };

    case "EVENT_CLOSED":
      return { ...state, selectedEvent: null, selectedUid: null };

    case "NAVIGATE_PREV": {
      if (!state.selectedEvent || !state.selectedUid) return state;
      const siblings = getUidEvents(state.events, state.selectedUid);
      const idx = siblings.findIndex((e) => e.id === state.selectedEvent!.id);
      const prev = idx > 0 ? siblings[idx - 1] : undefined;
      if (!prev) return state;
      return { ...state, selectedEvent: prev };
    }

    case "NAVIGATE_NEXT": {
      if (!state.selectedEvent || !state.selectedUid) return state;
      const siblings = getUidEvents(state.events, state.selectedUid);
      const idx = siblings.findIndex((e) => e.id === state.selectedEvent!.id);
      const next = idx >= 0 ? siblings[idx + 1] : undefined;
      if (!next) return state;
      return { ...state, selectedEvent: next };
    }

    case "TOGGLE_PAUSE":
      return { ...state, paused: !state.paused };

    default:
      return state;
  }
}
