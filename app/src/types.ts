import { z } from 'zod';

export const EventsResponseSchema = z.object({
  events: z.array(z.string()),
  nextCursor: z.string().nullable(),
});

export type EventsResponse = z.infer<typeof EventsResponseSchema>;

// Single source of truth for the event shape: drives both the KubeEvent type
// and the runtime guard in parseEvent. looseObject keeps server-only fields
// (series, fieldPath, ...) so the YAML detail view stays complete.
export const KubeEventSchema = z.looseObject({
  id: z.string().min(1),
  apiVersion: z.string(),
  kind: z.literal('Event'),
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
  type: z.enum(['Normal', 'Warning']),
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

export type ParsedEvent =
  | { status: 'ok'; data: KubeEvent; raw: string }
  | { status: 'malformed'; raw: string; id: string };

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
export type Rate = 'slow' | 'medium' | 'fast' | 'ludicrous';
export type TypeFilter = 'all' | 'Normal' | 'Warning';

export const Rate = {
  Slow: 'slow',
  Medium: 'medium',
  Fast: 'fast',
  Ludicrous: 'ludicrous',
} as const;

export const EventType = {
  Normal: 'Normal',
  Warning: 'Warning',
} as const;

export const ConnectionStatus = {
  Connecting: 'connecting',
  Connected: 'connected',
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
} as const;

export const ParseStatus = {
  Ok: 'ok',
  Malformed: 'malformed',
} as const;