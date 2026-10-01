import { useLayoutEffect, useRef, useState } from "react";
import {
  List,
  type RowComponentProps,
  type ListImperativeAPI,
} from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import type {
  ParsedEvent,
  KubeEvent,
  TypeFilter,
  ConnectionStatus,
} from "../types";
import type { FacetFilter } from "../store/eventsReducer";
import { rowsPrepended } from "../utils/scrollAnchor";
import { matchesFilter } from "../utils/matchesFilter";

const ROW_HEIGHT = 52;
// closer than this to the top, the list follows new events
const FOLLOW_THRESHOLD_PX = 50;

interface Props {
  events: ParsedEvent[];
  filter: string;
  typeFilter: TypeFilter;
  namespaceFilter: FacetFilter;
  reasonFilter: FacetFilter;
  connectionStatus: ConnectionStatus;
  onSelect: (event: KubeEvent) => void;
}

function emptyMessage(hasEvents: boolean, status: ConnectionStatus): string {
  if (hasEvents) return "No events match your filter";
  if (status === "reconnecting" || status === "disconnected")
    return "Connection lost. Reconnecting…";
  return "Waiting for events…";
}

interface RowData {
  events: ParsedEvent[];
  onSelect: (event: KubeEvent) => void;
}

type RowProps = RowComponentProps<RowData>;

const Row = ({ index, style, events, onSelect }: RowProps) => {
  // Rows are keyed by index. While the list follows a fast stream the row
  // under the pointer can show another event by the time the click lands,
  // so the click opens the event that was on screen when it was pressed.
  const pressed = useRef<KubeEvent | null>(null);
  const event = events[index];
  if (!event) return null;

  if (event.status === "malformed") {
    return (
      <div
        style={style}
        className="px-4 py-2 border-b border-gray-800/50 text-gray-600 italic font-mono flex items-center"
      >
        malformed event
      </div>
    );
  }

  const { data: d } = event;
  const isWarning = d.type === "Warning";
  // first line only, so multi-line messages keep the row height
  const messagePreview = d.message.split("\n", 1)[0];

  return (
    <button
      type="button"
      style={style}
      data-event-id={d.id}
      onPointerDown={() => {
        pressed.current = d;
      }}
      onPointerLeave={() => {
        pressed.current = null;
      }}
      onClick={() => {
        onSelect(pressed.current ?? d);
        pressed.current = null;
      }}
      aria-label={`${d.type} event, ${d.involvedObject.namespace}/${d.involvedObject.name}, ${d.reason}`}
      className="w-full text-left px-4 py-1.5 border-b border-gray-800/50 flex flex-col justify-center gap-0.5 cursor-pointer hover:bg-gray-900 transition-colors font-mono"
    >
      <span className="flex items-baseline gap-3">
        <span
          className={`shrink-0 w-14 md:w-16 ${isWarning ? "text-yellow-400" : "text-green-400"}`}
        >
          {d.type}
        </span>
        <span className="shrink-0 text-gray-500 w-20 md:w-24 truncate">
          {d.involvedObject.namespace}
        </span>
        <span className="shrink-0 text-gray-300 w-24 md:w-32 truncate">
          {d.involvedObject.name}
        </span>
        <span className="shrink-0 text-blue-400 w-20 md:w-24 truncate">
          {d.reason}
        </span>
        <span className="shrink-0 text-gray-700 ml-auto w-16 md:w-20 text-right">
          {new Date(d.lastTimestamp).toLocaleTimeString()}
        </span>
      </span>
      <span className="text-gray-500 truncate pl-[calc(3.5rem+1rem)] md:pl-[calc(4rem+1rem)]">
        {messagePreview}
      </span>
    </button>
  );
};

export function EventList({
  events,
  filter,
  typeFilter,
  namespaceFilter,
  reasonFilter,
  connectionStatus,
  onSelect,
}: Props) {
  // already newest-first
  const filters = {
    text: filter,
    type: typeFilter,
    namespace: namespaceFilter,
    reason: reasonFilter,
  };
  const filtered = events.filter((e) => matchesFilter(e, filters));
  const rowProps = { events: filtered, onSelect };

  const listRef = useRef<ListImperativeAPI | null>(null);
  const shownRef = useRef(filtered);
  const [following, setFollowing] = useState(true);

  // Before paint, so nothing jumps: stay at the top while following,
  // otherwise shift down by the rows added above so what you're reading
  // stays put.
  useLayoutEffect(() => {
    const added = rowsPrepended(shownRef.current, filtered);
    shownRef.current = filtered;
    const el = listRef.current?.element;
    if (!el) return;
    if (following) el.scrollTop = 0;
    else if (added > 0) el.scrollTop += added * ROW_HEIGHT;
  }, [filtered, following]);

  return (
    <div className="h-full font-mono relative text-sm">
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-4 right-6 z-10 text-xs font-mono px-3 py-1.5 rounded border bg-gray-900 border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 transition-colors shadow-lg"
        >
          ↑ back to newest
        </button>
      )}
      {filtered.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm font-mono pointer-events-none">
          {emptyMessage(events.length > 0, connectionStatus)}
        </div>
      )}
      <AutoSizer
        renderProp={({ height, width }) => (
          <List
            listRef={listRef}
            style={{ height: height ?? 0, width: width ?? 0 }}
            rowComponent={Row}
            rowCount={filtered.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            overscanCount={10}
            onScroll={(e: React.UIEvent<HTMLDivElement>) =>
              setFollowing(e.currentTarget.scrollTop < FOLLOW_THRESHOLD_PX)
            }
          />
        )}
      />
    </div>
  );
}
