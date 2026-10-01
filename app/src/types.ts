import { z } from "zod";

export const EventsResponseSchema = z.object({
  events: z.array(z.string()),
  nextCursor: z.string().nullable(),
});

export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// Drives both the KubeEvent type and the check in parseEvent. looseObject
// keeps the extra server fields (series, fieldPath...) for the YAML view.
export const KubeEventSchema = z.looseObject({
  id: z.string().min(1),
  apiVersion: z.string(),
  kind: z.literal("Event"),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string(),
    uid: z.string(),
    resourceVersion: z.string(),
    creationTimestamp: z.string(),
  }),
  involvedObject: z.looseObject({
    apiVersion: z.string(),
    kind: z.string(),
    name: z.string(),
    namespace: z.string(),
    uid: z.string().min(1),
    resourceVersion: z.string(),
  }),
  type: z.enum(["Normal", "Warning"]),
  reason: z.string(),
  action: z.string(),
  message: z.string(),
  source: z.looseObject({
    component: z.string(),
    host: z.string(),
  }),
  reportingComponent: z.string(),
  reportingInstance: z.string(),
  firstTimestamp: z.string(),
  lastTimestamp: z.string(),
  eventTime: z.string(),
  count: z.number(),
});

export type KubeEvent = z.infer<typeof KubeEventSchema>;

// raw is kept for malformed events only, there is nothing else to show.
// Older snapshots with raw on ok events still parse (z.object drops it).
export const ParsedEventSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), data: KubeEventSchema }),
  z.object({ status: z.literal("malformed"), raw: z.string(), id: z.string() }),
]);

export type ParsedEvent = z.infer<typeof ParsedEventSchema>;

// validated like network data: an older build may have saved another shape
export const EventSnapshotSchema = z.object({
  events: z.array(ParsedEventSchema),
  cursor: z.string().nullable(),
});

export type EventSnapshot = z.infer<typeof EventSnapshotSchema>;

export const RATES = ["slow", "medium", "fast", "ludicrous"] as const;

// GET /config also returns the other server settings; only rate is read here.
export const ConfigResponseSchema = z.looseObject({ rate: z.enum(RATES) });

export type ConnectionStatus =
  "connecting" | "connected" | "disconnected" | "reconnecting";
export type Rate = (typeof RATES)[number];
export type TypeFilter = "all" | "Normal" | "Warning";
