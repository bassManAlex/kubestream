export interface EventsResponse {
  events: string[];
  nextCursor: string | null;
}

export interface KubeEvent {
  id: string;
  apiVersion: string;
  kind: 'Event';
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    creationTimestamp: string;
  };
  involvedObject: {
    apiVersion: string;
    kind: string;
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
  };
  type: 'Normal' | 'Warning';
  reason: string;
  action: string;
  message: string;
  source: {
    component: string;
    host: string;
  };
  reportingComponent: string;
  reportingInstance: string;
  firstTimestamp: string;
  lastTimestamp: string;
  eventTime: string;
  count: number;
}

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