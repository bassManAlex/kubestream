import type { ParsedEvent } from "../types";
import { KubeEventSchema } from "../types";

let malformedCounter = 0;

export function parseEvent(raw: string): ParsedEvent {
  try {
    const result = KubeEventSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new Error("Event failed schema validation");
    }
    return { status: "ok", data: result.data, raw };
  } catch {
    return {
      status: "malformed",
      raw,
      id: `malformed_${++malformedCounter}_${Date.now()}`,
    };
  }
}
