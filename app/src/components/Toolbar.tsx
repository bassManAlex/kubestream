import { useState, useEffect, useRef } from "react";
import {
  ConfigResponseSchema,
  RATES,
  type ConnectionStatus,
  type Rate,
  type TypeFilter,
} from "../types";
import type { FacetFilter } from "../store/eventsReducer";
import { SERVER_URL } from "../config/serverUrl";

const FILTER_DEBOUNCE_MS = 150;

interface Props {
  connectionStatus: ConnectionStatus;
  filter: string;
  onFilterChange: (value: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (value: TypeFilter) => void;
  namespaces: Set<string>;
  namespaceFilter: FacetFilter;
  onNamespaceFilterChange: (value: FacetFilter) => void;
  reasons: Set<string>;
  reasonFilter: FacetFilter;
  onReasonFilterChange: (value: FacetFilter) => void;
}

const TYPE_FILTERS: TypeFilter[] = ["all", "Normal", "Warning"];

// prefixed values, so "" (no filter) can't clash with a real name
const ANY_OPTION = "";
const toOption = (value: FacetFilter): string =>
  value === null ? ANY_OPTION : `=${value}`;
const fromOption = (option: string): FacetFilter =>
  option === ANY_OPTION ? null : option.slice(1);

async function patchRate(rate: Rate) {
  const res = await fetch(`${SERVER_URL}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rate }),
  });
  if (!res.ok) throw new Error(`PATCH /config failed: ${res.status}`);
}

export function Toolbar({
  connectionStatus,
  filter,
  onFilterChange,
  paused,
  onTogglePause,
  typeFilter,
  onTypeFilterChange,
  namespaces,
  namespaceFilter,
  onNamespaceFilterChange,
  reasons,
  reasonFilter,
  onReasonFilterChange,
}: Props) {
  // null until GET /config answers
  const [rate, setRate] = useState<Rate | null>(null);
  const rateRequest = useRef(0);

  // Debounced local value. The callback goes through a ref so the timer only
  // restarts on typing, not on every App render (under load it would never fire).
  const [text, setText] = useState(filter);
  const onFilterChangeRef = useRef(onFilterChange);
  useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
  });
  useEffect(() => {
    const id = setTimeout(
      () => onFilterChangeRef.current(text),
      FILTER_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [text]);

  // Read on every (re)connect: a restarted server may run another rate. A
  // click made while the request is out wins over its answer.
  const connected = connectionStatus === "connected";
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const request = rateRequest.current;
    void fetch(`${SERVER_URL}/config`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`GET /config failed: ${r.status}`);
        return r.json();
      })
      .then((body: unknown) => {
        const cfg = ConfigResponseSchema.safeParse(body);
        if (cfg.success && rateRequest.current === request) {
          setRate(cfg.data.rate);
        }
      })
      .catch(() => null);
    return () => controller.abort();
  }, [connected]);

  const handleRate = (r: Rate) => {
    const prev = rate;
    const request = ++rateRequest.current;
    setRate(r);
    // revert on failure, unless a newer click already replaced it
    void patchRate(r).catch(() => {
      if (rateRequest.current === request) setRate(prev);
    });
  };

  return (
    <div className="border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onTogglePause}
        aria-pressed={paused}
        className={`shrink-0 text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
          paused
            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
            : "bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500"
        }`}
      >
        {paused ? "▶ resume" : "⏸ pause"}
      </button>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Filter events..."
        aria-label="Filter events by text (case sensitive)"
        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
      />

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <div className="flex items-center gap-1">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTypeFilterChange(t)}
            aria-pressed={typeFilter === t}
            className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
              typeFilter === t
                ? t === "Warning"
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                  : t === "Normal"
                    ? "bg-green-500/20 text-green-400 border-green-500/40"
                    : "bg-blue-500/20 text-blue-400 border-blue-500/40"
                : "bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <select
        value={toOption(namespaceFilter)}
        onChange={(e) => onNamespaceFilterChange(fromOption(e.target.value))}
        aria-label="Filter by namespace"
        className="text-xs font-mono px-2 py-1.5 rounded border bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 focus:outline-none focus:border-gray-500"
      >
        <option value={ANY_OPTION}>all namespaces</option>
        {[...namespaces].sort().map((ns) => (
          <option key={ns} value={toOption(ns)}>
            {ns}
          </option>
        ))}
      </select>

      <select
        value={toOption(reasonFilter)}
        onChange={(e) => onReasonFilterChange(fromOption(e.target.value))}
        aria-label="Filter by reason"
        className="text-xs font-mono px-2 py-1.5 rounded border bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 focus:outline-none focus:border-gray-500"
      >
        <option value={ANY_OPTION}>all reasons</option>
        {[...reasons].sort().map((r) => (
          <option key={r} value={toOption(r)}>
            {r}
          </option>
        ))}
      </select>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <div className="flex items-center gap-1">
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => handleRate(r)}
            aria-pressed={rate === r}
            className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
              rate === r
                ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                : "bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
