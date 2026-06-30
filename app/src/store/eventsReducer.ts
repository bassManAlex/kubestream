import type { KubeEvent, ParsedEvent, ConnectionStatus, TypeFilter } from '../types';
import { ConnectionStatus as CS } from '../types';
import { getUidEvents } from '../utils/siblings';

export interface EventsState {
  events: ParsedEvent[];
  cursor: string | null;
  connectionStatus: ConnectionStatus;
  filter: string;
  typeFilter: TypeFilter;
  selectedEvent: KubeEvent | null;
  selectedUid: string | null;
  paused: boolean;
  malformedCount: number;
}

export const initialState: EventsState = {
  events: [],
  cursor: null,
  connectionStatus: CS.Connecting,
  filter: '',
  typeFilter: 'all',
  selectedEvent: null,
  selectedUid: null,
  paused: false,
  malformedCount: 0,
};

export type EventsAction =
  | { type: 'EVENTS_RECEIVED'; payload: ParsedEvent[] }
  | { type: 'CURSOR_UPDATED'; payload: string }
  | { type: 'CONNECTION_STATUS_CHANGED'; payload: ConnectionStatus }
  | { type: 'FILTER_CHANGED'; payload: string }
  | { type: 'TYPE_FILTER_CHANGED'; payload: TypeFilter }
  | { type: 'EVENT_SELECTED'; payload: KubeEvent }
  | { type: 'EVENT_CLOSED' }
  | { type: 'NAVIGATE_PREV' }
  | { type: 'NAVIGATE_NEXT' }
  | { type: 'TOGGLE_PAUSE' };

export const MAX_EVENTS = 2000;

export function eventsReducer(state: EventsState, action: EventsAction): EventsState {
  switch (action.type) {

    case 'EVENTS_RECEIVED': {
      if (state.paused) return state;
      const malformedCount = action.payload.filter(e => e.status === 'malformed').length;
      // payload is chronological (oldest -> newest); the store is newest-first,
      // so prepend the reversed batch and trim the oldest from the tail.
      const merged = [...[...action.payload].reverse(), ...state.events];
      const trimmed = merged.length > MAX_EVENTS
        ? merged.slice(0, MAX_EVENTS)
        : merged;
      return {
        ...state,
        events: trimmed,
        malformedCount: state.malformedCount + malformedCount,
      };
    }

    case 'CURSOR_UPDATED':
      return { ...state, cursor: action.payload };

    case 'CONNECTION_STATUS_CHANGED':
      return { ...state, connectionStatus: action.payload };

    case 'FILTER_CHANGED':
      return { ...state, filter: action.payload };

    case 'TYPE_FILTER_CHANGED':
      return { ...state, typeFilter: action.payload };

    case 'EVENT_SELECTED':
      return {
        ...state,
        selectedEvent: action.payload,
        selectedUid: action.payload.involvedObject.uid,
      };

    case 'EVENT_CLOSED':
      return { ...state, selectedEvent: null, selectedUid: null };

    case 'NAVIGATE_PREV': {
      if (!state.selectedEvent || !state.selectedUid) return state;
      const siblings = getUidEvents(state.events, state.selectedUid);
      const idx = siblings.findIndex(e => e.id === state.selectedEvent!.id);
      const prev = idx > 0 ? siblings[idx - 1] : undefined;
      if (!prev) return state;
      return { ...state, selectedEvent: prev };
    }

    case 'NAVIGATE_NEXT': {
      if (!state.selectedEvent || !state.selectedUid) return state;
      const siblings = getUidEvents(state.events, state.selectedUid);
      const idx = siblings.findIndex(e => e.id === state.selectedEvent!.id);
      const next = idx >= 0 ? siblings[idx + 1] : undefined;
      if (!next) return state;
      return { ...state, selectedEvent: next };
    }

    case 'TOGGLE_PAUSE':
      return { ...state, paused: !state.paused };

    default:
      return state;
  }
}