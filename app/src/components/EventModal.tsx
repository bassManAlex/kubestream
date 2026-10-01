import { useEffect, useRef, useState } from "react";
import { dump } from "js-yaml";
import type { KubeEvent, ParsedEvent } from "../types";
import { useKeyboard } from "../hooks/useKeyboard";
import { getUidEvents } from "../utils/siblings";

const FOCUSABLE =
  'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';

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

  const siblings = getUidEvents(events, uid);
  const currentIndex = siblings.findIndex((e) => e.id === event.id);
  // -1 once the event has left the buffer: keep the YAML, disable prev/next
  const inBuffer = currentIndex !== -1;
  const hasPrev = inBuffer && currentIndex > 0;
  const hasNext = inBuffer && currentIndex < siblings.length - 1;

  const yaml = dump(event, { indent: 2 });

  useKeyboard({ onClose, onPrev, onNext });

  const dialogRef = useRef<HTMLDivElement>(null);
  // a selection dragged out of the dialog also ends with a backdrop click
  const pressedOnBackdrop = useRef(false);

  // Focus the dialog, and give focus back to the row on close. Rows are
  // recycled by index, so the one that opened the dialog may show another
  // event by then: look the event up instead.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const openedFrom = previouslyFocused?.dataset.eventId;
    dialogRef.current?.focus();
    return () => {
      if (openedFrom === undefined) {
        previouslyFocused?.focus();
        return;
      }
      const row = [
        ...document.querySelectorAll<HTMLElement>("[data-event-id]"),
      ].find((el) => el.dataset.eventId === openedFrom);
      row?.focus();
    };
  }, []);

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Tab trap. Focus starts on the container, which is neither first nor
  // last, so that case wraps too.
  const handleTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    const inside = focusable.some((el) => el === active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (insecure context) or permission denied
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget)
          onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Event detail: ${event.involvedObject.namespace}/${event.involvedObject.name} ${event.reason}`}
        tabIndex={-1}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col focus:outline-none"
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
              type="button"
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
              type="button"
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
            {inBuffer
              ? `${currentIndex + 1} / ${siblings.length} events for this object`
              : "no longer in buffer"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={!hasPrev}
              className="font-mono text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← prev
            </button>
            <button
              type="button"
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
