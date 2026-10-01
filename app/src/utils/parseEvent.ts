import type { ParsedEvent } from "../types";
import { KubeEventSchema } from "../types";

let malformedCounter = 0;

// deliveryId is the id the event came with (SSE id, or the page's
// nextCursor). Malformed events reuse it so the cursor can move past them.
export function parseEvent(raw: string, deliveryId?: string): ParsedEvent {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const result = KubeEventSchema.safeParse(json);
  if (result.success) return { status: "ok", data: result.data };
  return {
    status: "malformed",
    raw,
    id: deliveryId || `malformed_${++malformedCounter}_${Date.now()}`,
  };
}
