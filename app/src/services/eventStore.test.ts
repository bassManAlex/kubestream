import { describe, it, expect } from "vitest";
import { parseSnapshot } from "./eventStore";

const okEvent = {
  status: "ok",
  data: {
    id: "evt_1",
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: "evt-1",
      namespace: "default",
      uid: "meta-1",
      resourceVersion: "1",
      creationTimestamp: "2024-01-01T00:00:00Z",
    },
    involvedObject: {
      apiVersion: "v1",
      kind: "Pod",
      name: "my-pod",
      namespace: "default",
      uid: "uid-1",
      resourceVersion: "1",
    },
    type: "Normal",
    reason: "Started",
    action: "start",
    message: "Started container",
    source: { component: "kubelet", host: "node-1" },
    reportingComponent: "kubelet",
    reportingInstance: "node-1",
    firstTimestamp: "2024-01-01T00:00:00Z",
    lastTimestamp: "2024-01-01T00:00:00Z",
    eventTime: "2024-01-01T00:00:00Z",
    count: 1,
  },
};

const malformedEvent = { status: "malformed", raw: "{bad", id: "evt_2" };

describe("parseSnapshot", () => {
  it("accepts a snapshot of ok and malformed events", () => {
    const snapshot = { events: [okEvent, malformedEvent], cursor: "evt_2" };
    expect(parseSnapshot(snapshot)).toEqual(snapshot);
  });

  it("returns null when nothing was stored", () => {
    expect(parseSnapshot(undefined)).toBeNull();
  });

  it("discards a snapshot whose events no longer match the schema", () => {
    const stale = {
      events: [{ ...okEvent, data: { ...okEvent.data, involvedObject: {} } }],
      cursor: "evt_1",
    };
    expect(parseSnapshot(stale)).toBeNull();
  });

  it("discards a snapshot with an invalid cursor", () => {
    expect(parseSnapshot({ events: [], cursor: 42 })).toBeNull();
  });
});
