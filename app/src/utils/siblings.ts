import type { KubeEvent, ParsedEvent } from "../types";

// Returns the ok events for an entity uid in chronological (oldest -> newest)
// order. The store keeps events newest-first, so we reverse here: prev/next
// navigation and the "n / total" counter both read chronologically.
export function getUidEvents(events: ParsedEvent[], uid: string): KubeEvent[] {
  const matches = events.flatMap((e) =>
    e.status === "ok" && e.data.involvedObject.uid === uid ? [e.data] : [],
  );
  matches.reverse();
  return matches;
}
