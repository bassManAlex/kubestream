import { useMemo, useRef, useEffect, useState } from "react";
import { List, type RowComponentProps, type ListImperativeAPI } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import type { ParsedEvent, KubeEvent, TypeFilter } from "../types";
import { EventType } from "../types";

interface Props {
  events: ParsedEvent[];
  filter: string;
  typeFilter: TypeFilter;
  onSelect: (event: KubeEvent) => void;
}

function matchesFilter(
  event: ParsedEvent,
  filter: string,
  typeFilter: TypeFilter,
): boolean {
  if (event.status === "malformed")
    return typeFilter === "all" && (!filter || event.raw.includes(filter));
  const d = event.data;
  if (typeFilter !== "all" && d.type !== typeFilter) return false;
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

  return (
    <div
      style={style}
      onClick={() => onSelect(d)}
      className="px-4 py-2 border-b border-gray-800/50 flex items-baseline gap-3 cursor-pointer hover:bg-gray-900 transition-colors font-mono"
    >
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
      <span className="text-gray-500 truncate flex-1 min-w-0">{d.message}</span>
      <span className="shrink-0 text-gray-700 w-16 md:w-20 text-right">
        {new Date(d.lastTimestamp).toLocaleTimeString()}
      </span>
    </div>
  );
};

export function EventList({ events, filter, typeFilter, onSelect }: Props) {
  const filtered = useMemo(
    () =>
      [...events].reverse().filter((e) => matchesFilter(e, filter, typeFilter)),
    [events, filter, typeFilter],
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
      <AutoSizer
        renderProp={({ height, width }) => (
          <List
            listRef={listRef}
            style={{ height: height ?? 0, width: width ?? 0 }}
            rowComponent={Row}
            rowCount={filtered.length}
            rowHeight={36}
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
