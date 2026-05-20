import { useEffect } from "react";

interface Options {
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  active: boolean;
}

export function useKeyboard({ onClose, onPrev, onNext, active }: Options) {
  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose, onPrev, onNext]);
}
