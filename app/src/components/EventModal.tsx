import { useMemo, useState } from "react";
import { dump } from "js-yaml";
import type { KubeEvent, ParsedEvent } from "../types";
import { useKeyboard } from "../hooks/useKeyboard";

interface Props {
  event: KubeEvent;
  uid: string;
  events: ParsedEvent[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function getUidEvents(events: ParsedEvent[], uid: string): KubeEvent[] {
  return events
    .filter(
      (e): e is Extract<ParsedEvent, { status: "ok" }> => e.status === "ok",
    )
    .map((e) => e.data)
    .filter((e) => e.involvedObject.uid === uid);
}

export function EventModal({
  event,
  uid,
  events,
  onClose,
  onPrev,
  onNext,
}: Props) {
  const [copied, setCopied] = useState(false);

  const siblings = useMemo(() => getUidEvents(events, uid), [events, uid]);
  const currentIndex = siblings.findIndex((e) => e.id === event.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < siblings.length - 1;

  const yaml = useMemo(() => {
    try {
      return dump(event, { indent: 2 });
    } catch {
      return "Failed to serialize event";
    }
  }, [event]);

  useKeyboard({ onClose, onPrev, onNext, active: true });

  const handleCopy = () => {
    navigator.clipboard.writeText(yaml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-gray-400">
              {event.involvedObject.namespace}
            </span>
            <span className="text-gray-600">/</span>
            <span className="text-gray-200">{event.involvedObject.name}</span>
            <span className="text-blue-400">{event.reason}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className={`text-xs font-mono px-3 py-1 rounded border transition-colors ${
                copied
                  ? "bg-green-500/20 text-green-400 border-green-500/40"
                  : "bg-transparent text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-500"
              }`}
            >
              {copied ? "✓ copied" : "copy yaml"}
            </button>
            <button
              onClick={onClose}
              className="text-gray-600 hover:text-gray-300 text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <pre className="font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
            {yaml}
          </pre>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
          <span className="font-mono text-xs text-gray-600">
            {currentIndex + 1} / {siblings.length} events for this object
          </span>
          <div className="flex gap-2">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="font-mono text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← prev
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="font-mono text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
