import type { ParsedEvent, TypeFilter } from "../types";
import type { FacetFilter } from "../store/eventsReducer";

export interface Filters {
  text: string;
  type: TypeFilter;
  namespace: FacetFilter;
  reason: FacetFilter;
}

// Case sensitive. A malformed event has no fields, so it only shows without
// facet filters, and the text is matched against its raw payload.
export function matchesFilter(event: ParsedEvent, filters: Filters): boolean {
  const { text, type, namespace, reason } = filters;
  if (event.status === "malformed")
    return (
      type === "all" &&
      namespace === null &&
      reason === null &&
      (!text || event.raw.includes(text))
    );
  const d = event.data;
  if (type !== "all" && d.type !== type) return false;
  if (namespace !== null && d.involvedObject.namespace !== namespace)
    return false;
  if (reason !== null && d.reason !== reason) return false;
  if (!text) return true;
  return (
    d.involvedObject.name.includes(text) ||
    d.involvedObject.namespace.includes(text) ||
    d.reason.includes(text) ||
    d.message.includes(text) ||
    d.type.includes(text)
  );
}
