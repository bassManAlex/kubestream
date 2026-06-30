import { useEffect, useMemo, useRef, useState } from "react";
import { dump } from "js-yaml";
import type { KubeEvent, ParsedEvent } from "../types";
import { useKeyboard } from "../hooks/useKeyboard";
import { getUidEvents } from "../utils/siblings";

interface Props {
  event: KubeEvent;
  uid: string;
  events: ParsedEvent[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
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

  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open and restore it to the triggering
  // element on close, so keyboard users are not stranded at the page top.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (insecure context) or permission denied
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Event detail: ${event.involvedObject.namespace}/${event.involvedObject.name} ${event.reason}`}
        tabIndex={-1}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTabKey}
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
              onClick={() => void handleCopy()}
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
              aria-label="Close event detail"
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
