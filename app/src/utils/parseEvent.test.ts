import { describe, it, expect } from "vitest";
import { parseEvent } from "./parseEvent";
import type { KubeEvent } from "../types";

const baseEvent: KubeEvent = {
  id: "evt-001",
  apiVersion: "v1",
  kind: "Event",
  metadata: {
    name: "pod-crash.001",
    namespace: "default",
    uid: "meta-uid-001",
    resourceVersion: "1",
    creationTimestamp: "2024-01-01T00:00:00Z",
  },
  involvedObject: {
    apiVersion: "v1",
    kind: "Pod",
    name: "my-pod",
    namespace: "default",
    uid: "obj-uid-001",
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
};

describe("parseEvent", () => {
  it("parses a valid event", () => {
    const raw = JSON.stringify(baseEvent);
    const result = parseEvent(raw);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.id).toBe("evt-001");
      expect(result.raw).toBe(raw);
    }
  });

  it("returns malformed for invalid JSON", () => {
    const raw = "not json at all {{{";
    const result = parseEvent(raw);
    expect(result.status).toBe("malformed");
    if (result.status === "malformed") {
      expect(result.raw).toBe(raw);
      expect(result.id).toMatch(/^malformed_/);
    }
  });

  it("returns malformed when id is missing", () => {
    const { id: _id, ...noId } = baseEvent;
    const result = parseEvent(JSON.stringify(noId));
    expect(result.status).toBe("malformed");
  });

  it("returns malformed when involvedObject.uid is missing", () => {
    const broken = {
      ...baseEvent,
      involvedObject: { ...baseEvent.involvedObject, uid: undefined },
    };
    const result = parseEvent(JSON.stringify(broken));
    expect(result.status).toBe("malformed");
  });

  it("assigns unique ids to consecutive malformed events", () => {
    const raw = "bad";
    const a = parseEvent(raw);
    const b = parseEvent(raw);
    expect(a.status).toBe("malformed");
    expect(b.status).toBe("malformed");
    if (a.status === "malformed" && b.status === "malformed") {
      expect(a.id).not.toBe(b.id);
    }
  });

  it("never throws regardless of input", () => {
    const inputs = ["", "null", "[]", "{}", '{"id":null}'];
    for (const raw of inputs) {
      expect(() => parseEvent(raw)).not.toThrow();
    }
  });
});
