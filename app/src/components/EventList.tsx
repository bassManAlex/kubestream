import { useMemo, useRef, useEffect, useState } from "react";
import { List, type RowComponentProps, type ListImperativeAPI } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import type {
  ParsedEvent,
  KubeEvent,
  TypeFilter,
  ConnectionStatus,
} from "../types";
import { EventType, ConnectionStatus as CS } from "../types";
import type { FacetFilter } from "../store/eventsReducer";

interface Props {
  events: ParsedEvent[];
  filter: string;
  typeFilter: TypeFilter;
  namespaceFilter: FacetFilter;
  reasonFilter: FacetFilter;
  connectionStatus: ConnectionStatus;
  onSelect: (event: KubeEvent) => void;
}

function emptyMessage(
  hasEvents: boolean,
  status: ConnectionStatus,
): string {
  if (hasEvents) return "No events match your filter";
  if (status === CS.Reconnecting || status === CS.Disconnected)
    return "Connection lost. Reconnecting…";
  return "Waiting for events…";
}

function matchesFilter(
  event: ParsedEvent,
  filter: string,
  typeFilter: TypeFilter,
  namespaceFilter: FacetFilter,
  reasonFilter: FacetFilter,
): boolean {
  if (event.status === "malformed")
    return (
      typeFilter === "all" &&
      namespaceFilter === "all" &&
      reasonFilter === "all" &&
      (!filter || event.raw.includes(filter))
    );
  const d = event.data;
  if (typeFilter !== "all" && d.type !== typeFilter) return false;
  if (namespaceFilter !== "all" && d.involvedObject.namespace !== namespaceFilter) return false;
  if (reasonFilter !== "all" && d.reason !== reasonFilter) return false;
  if (!filter) return true;
  return (
    d.involvedObject.name.includes(filter) ||
    d.involvedObject.namespace.includes(filter) ||
    d.reason.includes(filter) ||
    d.message.includes(filter) ||
    d.type.includes(filter)
  );
}

interface RowData {
  events: ParsedEvent[];
  onSelect: (event: KubeEvent) => void;
}

type RowProps = RowComponentProps<RowData>;

const Row = ({ index, style, events, onSelect }: RowProps) => {
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
  const isWarning = d.type === EventType.Warning;
  // message's first line shown inline below the header row, so multi-line
  // payloads (stack traces, probe details, ...) don't push the row taller.
  const messagePreview = d.message.split("\n", 1)[0];

  return (
    <button
      type="button"
      style={style}
      onClick={() => onSelect(d)}
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
        <span className="shrink-0 text-blue-400 w-20 md:w-24 truncate">{d.reason}</span>
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
  // events is stored newest-first, so no reverse is needed here.
  const filtered = useMemo(
    () =>
      events.filter((e) =>
        matchesFilter(e, filter, typeFilter, namespaceFilter, reasonFilter),
      ),
    [events, filter, typeFilter, namespaceFilter, reasonFilter],
  );

  const itemData = useMemo(
    () => ({ events: filtered, onSelect }),
    [filtered, onSelect],
  );
  const listRef = useRef<ListImperativeAPI | null>(null);
  const programmaticScroll = useRef(false);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && filtered.length > 0) {
      programmaticScroll.current = true;
      listRef.current?.scrollToRow({ index: 0, align: "start" });
    }
  }, [filtered.length, autoScroll]);

  return (
    <div className="h-full font-mono relative text-sm">
      {!autoScroll && (
        <button
          onClick={() => setAutoScroll(true)}
          className="absolute bottom-4 right-6 z-10 text-xs font-mono px-3 py-1.5 rounded border bg-gray-900 border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 transition-colors shadow-lg"
        >
          ↓ resume scroll
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
            rowHeight={52}
            rowProps={itemData}
            overscanCount={10}
            onScroll={(e: React.UIEvent<HTMLDivElement>) => {
              if (programmaticScroll.current) {
                programmaticScroll.current = false;
                return;
              }
              const el = e.currentTarget;
              setAutoScroll(el.scrollTop < 50);
            }}
          />
        )}
      />
    </div>
  );
}
