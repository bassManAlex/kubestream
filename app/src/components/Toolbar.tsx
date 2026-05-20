import { useState, useEffect } from 'react';
import type { Rate, TypeFilter } from '../types';

interface Props {
  filter: string;
  onFilterChange: (value: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  typeFilter: TypeFilter;
  onTypeFilterChange: (value: TypeFilter) => void;
}

const RATES: Rate[] = ['slow', 'medium', 'fast', 'ludicrous'];
const TYPE_FILTERS: TypeFilter[] = ['all', 'Normal', 'Warning'];

async function patchRate(rate: Rate) {
  await fetch('/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate }),
  });
}

export function Toolbar({ filter, onFilterChange, paused, onTogglePause, typeFilter, onTypeFilterChange }: Props) {
  const [rate, setRate] = useState<Rate>('slow');

  useEffect(() => {
    fetch('/config')
      .then(r => r.json())
      .then(cfg => setRate(cfg.rate))
      .catch(() => null);
  }, []);

  const handleRate = (r: Rate) => {
    setRate(r);
    patchRate(r);
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
        value={filter}
        onChange={e => onFilterChange(e.target.value)}
        placeholder="Filter events..."
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