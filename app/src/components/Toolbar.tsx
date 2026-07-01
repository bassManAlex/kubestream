import { useState, useEffect, useRef } from 'react';
import type { Rate, TypeFilter } from '../types';
import type { FacetFilter } from '../store/eventsReducer';
import { SERVER_URL } from '../config/serverUrl';

const FILTER_DEBOUNCE_MS = 150;

interface Props {
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

const RATES: Rate[] = ['slow', 'medium', 'fast', 'ludicrous'];
const TYPE_FILTERS: TypeFilter[] = ['all', 'Normal', 'Warning'];

async function patchRate(rate: Rate) {
  const res = await fetch(`${SERVER_URL}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate }),
  });
  if (!res.ok) throw new Error(`PATCH /config failed: ${res.status}`);
}

export function Toolbar({
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
  const [rate, setRate] = useState<Rate>('slow');

  // Local input value with a debounced commit. The callback lives in a ref so
  // the debounce timer is keyed only on the text, not on App re-rendering on
  // every incoming event (which would otherwise starve the commit under load).
  const [text, setText] = useState(filter);
  const onFilterChangeRef = useRef(onFilterChange);
  useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
  });
  useEffect(() => {
    const id = setTimeout(() => onFilterChangeRef.current(text), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    void fetch(`${SERVER_URL}/config`)
      .then(r => r.json())
      .then((cfg: { rate: Rate }) => setRate(cfg.rate))
      .catch(() => null);
  }, []);

  const handleRate = (r: Rate) => {
    const prev = rate;
    setRate(r);
    // Revert the optimistic selection if the server never accepted it.
    void patchRate(r).catch(() => setRate(prev));
  };

  return (
    <div className="border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-3">
      <button
        onClick={onTogglePause}
        className={`shrink-0 text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
          paused
            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
            : 'bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500'
        }`}
      >
        {paused ? '▶ resume' : '⏸ pause'}
      </button>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Filter events..."
        aria-label="Filter events by exact text"
        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
      />

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <div className="flex items-center gap-1">
        {TYPE_FILTERS.map(t => (
          <button
            key={t}
            onClick={() => onTypeFilterChange(t)}
            className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
              typeFilter === t
                ? t === 'Warning'
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                  : t === 'Normal'
                    ? 'bg-green-500/20 text-green-400 border-green-500/40'
                    : 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                : 'bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <select
        value={namespaceFilter}
        onChange={e => onNamespaceFilterChange(e.target.value)}
        aria-label="Filter by namespace"
        className="text-xs font-mono px-2 py-1.5 rounded border bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 focus:outline-none focus:border-gray-500"
      >
        <option value="all">all namespaces</option>
        {[...namespaces].sort().map(ns => (
          <option key={ns} value={ns}>{ns}</option>
        ))}
      </select>

      <select
        value={reasonFilter}
        onChange={e => onReasonFilterChange(e.target.value)}
        aria-label="Filter by reason"
        className="text-xs font-mono px-2 py-1.5 rounded border bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 focus:outline-none focus:border-gray-500"
      >
        <option value="all">all reasons</option>
        {[...reasons].sort().map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      <div className="w-px h-5 bg-gray-700 shrink-0" />

      <div className="flex items-center gap-1">
        {RATES.map(r => (
          <button
            key={r}
            onClick={() => handleRate(r)}
            className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
              rate === r
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                : 'bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}