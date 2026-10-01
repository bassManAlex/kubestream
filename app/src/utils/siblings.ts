import type { KubeEvent, ParsedEvent } from "../types";

// ok events for one uid, oldest first (the store is newest-first)
export function getUidEvents(events: ParsedEvent[], uid: string): KubeEvent[] {
  const matches = events.flatMap((e) =>
    e.status === "ok" && e.data.involvedObject.uid === uid ? [e.data] : [],
  );
  matches.reverse();
  return matches;
}
