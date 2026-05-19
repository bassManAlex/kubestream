import type { KubeEvent, ParsedEvent } from "../types";

let malformedCounter = 0;

export function parseEvent(raw: string): ParsedEvent {
  try {
    const data = JSON.parse(raw) as KubeEvent;

    if (!data.id || !data.involvedObject?.uid) {
      throw new Error("Missing required fields");
    }

    return { status: "ok", data, raw };
  } catch {
    return {
      status: "malformed",
      raw,
      id: `malformed_${++malformedCounter}_${Date.now()}`,
    };
  }
}
