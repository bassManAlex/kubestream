import { describe, it, expect } from "vitest";
import { matchesFilter, type Filters } from "./matchesFilter";
import type { ParsedEvent } from "../types";

function okEvent(
  fields: {
    type?: "Normal" | "Warning";
    reason?: string;
    message?: string;
  } = {},
): ParsedEvent {
  return {
    status: "ok",
    data: {
      id: "evt_1",
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: "checkout-7f9c.1",
        namespace: "payments",
        uid: "meta-1",
        resourceVersion: "1",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      involvedObject: {
        apiVersion: "v1",
        kind: "Pod",
        name: "checkout-7f9c",
        namespace: "payments",
        uid: "uid-1",
        resourceVersion: "1",
      },
      type: fields.type ?? "Warning",
      reason: fields.reason ?? "BackOff",
      action: "Restarting",
      message: fields.message ?? "Container checkout keeps exiting",
      source: { component: "kubelet", host: "worker-a1" },
      reportingComponent: "kubelet",
      reportingInstance: "worker-a1",
      firstTimestamp: "2024-01-01T00:00:00Z",
      lastTimestamp: "2024-01-01T00:00:00Z",
      eventTime: "2024-01-01T00:00:00Z",
      count: 1,
    },
  };
}

const malformed: ParsedEvent = {
  status: "malformed",
  raw: '{"reason"="BackOff"',
  id: "evt_2",
};

const none: Filters = { text: "", type: "all", namespace: null, reason: null };

describe("matchesFilter", () => {
  it("lets everything through without filters", () => {
    expect(matchesFilter(okEvent(), none)).toBe(true);
    expect(matchesFilter(malformed, none)).toBe(true);
  });

  it("filters by type, namespace and reason", () => {
    const event = okEvent();
    expect(matchesFilter(event, { ...none, type: "Warning" })).toBe(true);
    expect(matchesFilter(event, { ...none, type: "Normal" })).toBe(false);
    expect(matchesFilter(event, { ...none, namespace: "payments" })).toBe(true);
    expect(matchesFilter(event, { ...none, namespace: "default" })).toBe(false);
    expect(matchesFilter(event, { ...none, reason: "BackOff" })).toBe(true);
    expect(matchesFilter(event, { ...none, reason: "Pulled" })).toBe(false);
  });

  it("matches text on name, namespace, reason, message and type", () => {
    const event = okEvent();
    for (const text of [
      "checkout-7f9c",
      "payments",
      "BackOff",
      "keeps exiting",
      "Warning",
    ]) {
      expect(matchesFilter(event, { ...none, text }), text).toBe(true);
    }
    // not searched: the reporting node
    expect(matchesFilter(event, { ...none, text: "worker-a1" })).toBe(false);
  });

  it("is case sensitive", () => {
    expect(matchesFilter(okEvent(), { ...none, text: "backoff" })).toBe(false);
  });

  it("hides malformed events once a facet filter is set", () => {
    expect(matchesFilter(malformed, { ...none, type: "Warning" })).toBe(false);
    expect(matchesFilter(malformed, { ...none, namespace: "payments" })).toBe(
      false,
    );
    expect(matchesFilter(malformed, { ...none, reason: "BackOff" })).toBe(
      false,
    );
  });

  it("matches text against the raw payload of a malformed event", () => {
    expect(matchesFilter(malformed, { ...none, text: "BackOff" })).toBe(true);
    expect(matchesFilter(malformed, { ...none, text: "Pulled" })).toBe(false);
  });
});
