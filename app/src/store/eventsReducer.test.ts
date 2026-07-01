import { describe, it, expect } from "vitest";
import { eventsReducer, initialState } from "./eventsReducer";
import type { EventsState, EventsAction } from "./eventsReducer";
import type { KubeEvent, ParsedEvent } from "../types";

function makeOkEvent(
  id: string,
  uid: string = "uid-1",
  overrides: { namespace?: string; reason?: string } = {},
): Extract<ParsedEvent, { status: "ok" }> {
  const namespace = overrides.namespace ?? "default";
  const reason = overrides.reason ?? "Started";
  return {
    status: "ok",
    raw: "{}",
    data: {
      id,
      apiVersion: "v1",
      kind: "Event",
      metadata: {
        name: `evt-${id}`,
        namespace,
        uid: `meta-${id}`,
        resourceVersion: "1",
        creationTimestamp: "2024-01-01T00:00:00Z",
      },
      involvedObject: {
        apiVersion: "v1",
        kind: "Pod",
        name: "my-pod",
        namespace,
        uid,
        resourceVersion: "1",
      },
      type: "Normal",
      reason,
      action: "start",
      message: "Started container",
      source: { component: "kubelet", host: "node-1" },
      reportingComponent: "kubelet",
      reportingInstance: "node-1",
      firstTimestamp: "2024-01-01T00:00:00Z",
      lastTimestamp: "2024-01-01T00:00:00Z",
      eventTime: "2024-01-01T00:00:00Z",
      count: 1,
    } satisfies KubeEvent,
  };
}

function makeMalformed(id: string): ParsedEvent {
  return { status: "malformed", raw: "bad", id };
}

function dispatch(state: EventsState, action: EventsAction): EventsState {
  return eventsReducer(state, action);
}

describe("eventsReducer — EVENTS_RECEIVED", () => {
  it("appends events to empty state", () => {
    const evt = makeOkEvent("1");
    const next = dispatch(initialState, { type: "EVENTS_RECEIVED", payload: [evt] });
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toBe(evt);
  });

  it("is a no-op when paused", () => {
    const paused: EventsState = { ...initialState, paused: true };
    const next = dispatch(paused, { type: "EVENTS_RECEIVED", payload: [makeOkEvent("1")] });
    expect(next).toBe(paused);
  });

  it("increments malformedCount for malformed events", () => {
    const next = dispatch(initialState, {
      type: "EVENTS_RECEIVED",
      payload: [makeMalformed("m1"), makeMalformed("m2"), makeOkEvent("1")],
    });
    expect(next.malformedCount).toBe(2);
  });

  it("caps events at 2000, dropping oldest (newest-first)", () => {
    const full: EventsState = {
      ...initialState,
      events: Array.from({ length: 2000 }, (_, i) => makeOkEvent(String(i))),
    };
    const newEvt = makeOkEvent("new");
    const next = dispatch(full, { type: "EVENTS_RECEIVED", payload: [newEvt] });
    expect(next.events).toHaveLength(2000);
    // newest is prepended; the oldest (tail) is dropped
    expect(next.events[0]).toBe(newEvt);
    expect(next.events[1]).toBe(full.events[0]);
    expect(next.events).not.toContain(full.events[1999]);
  });

  it("does not mutate existing events array", () => {
    const original = initialState.events;
    const next = dispatch(initialState, { type: "EVENTS_RECEIVED", payload: [makeOkEvent("1")] });
    expect(next.events).not.toBe(original);
  });

  it("accumulates namespace and reason facets across batches", () => {
    const first = dispatch(initialState, {
      type: "EVENTS_RECEIVED",
      payload: [makeOkEvent("1", "uid-1", { namespace: "default", reason: "Started" })],
    });
    expect(first.namespaces).toEqual(new Set(["default"]));
    expect(first.reasons).toEqual(new Set(["Started"]));

    const second = dispatch(first, {
      type: "EVENTS_RECEIVED",
      payload: [makeOkEvent("2", "uid-2", { namespace: "kube-system", reason: "BackOff" })],
    });
    expect(second.namespaces).toEqual(new Set(["default", "kube-system"]));
    expect(second.reasons).toEqual(new Set(["Started", "BackOff"]));
  });

  it("does not add facets for malformed events", () => {
    const next = dispatch(initialState, {
      type: "EVENTS_RECEIVED",
      payload: [makeMalformed("m1")],
    });
    expect(next.namespaces.size).toBe(0);
    expect(next.reasons.size).toBe(0);
  });
});

describe("eventsReducer — EVENTS_RESTORED", () => {
  it("rebuilds events, cursor, and facets from the snapshot", () => {
    const restoredEvents = [
      makeOkEvent("1", "uid-1", { namespace: "apps", reason: "Pulled" }),
      makeOkEvent("2", "uid-2", { namespace: "monitoring", reason: "Failed" }),
    ];
    const next = dispatch(initialState, {
      type: "EVENTS_RESTORED",
      payload: { events: restoredEvents, cursor: "evt_2" },
    });
    expect(next.events).toBe(restoredEvents);
    expect(next.cursor).toBe("evt_2");
    expect(next.namespaces).toEqual(new Set(["apps", "monitoring"]));
    expect(next.reasons).toEqual(new Set(["Pulled", "Failed"]));
  });
});

describe("eventsReducer — NAMESPACE_FILTER_CHANGED / REASON_FILTER_CHANGED", () => {
  it("updates the namespace filter", () => {
    const next = dispatch(initialState, { type: "NAMESPACE_FILTER_CHANGED", payload: "kube-system" });
    expect(next.namespaceFilter).toBe("kube-system");
  });

  it("updates the reason filter", () => {
    const next = dispatch(initialState, { type: "REASON_FILTER_CHANGED", payload: "BackOff" });
    expect(next.reasonFilter).toBe("BackOff");
  });
});

describe("eventsReducer — CURSOR_UPDATED", () => {
  it("updates cursor", () => {
    const next = dispatch(initialState, { type: "CURSOR_UPDATED", payload: "cursor-42" });
    expect(next.cursor).toBe("cursor-42");
  });
});

describe("eventsReducer — FILTER_CHANGED", () => {
  it("updates filter text", () => {
    const next = dispatch(initialState, { type: "FILTER_CHANGED", payload: "nginx" });
    expect(next.filter).toBe("nginx");
  });
});

describe("eventsReducer — TYPE_FILTER_CHANGED", () => {
  it("updates the type filter", () => {
    const next = dispatch(initialState, { type: "TYPE_FILTER_CHANGED", payload: "Warning" });
    expect(next.typeFilter).toBe("Warning");
  });
});

describe("eventsReducer — TOGGLE_PAUSE", () => {
  it("toggles paused from false to true", () => {
    const next = dispatch(initialState, { type: "TOGGLE_PAUSE" });
    expect(next.paused).toBe(true);
  });

  it("toggles paused from true to false", () => {
    const paused: EventsState = { ...initialState, paused: true };
    const next = dispatch(paused, { type: "TOGGLE_PAUSE" });
    expect(next.paused).toBe(false);
  });
});

describe("eventsReducer — EVENT_SELECTED / EVENT_CLOSED", () => {
  it("sets selectedEvent and selectedUid", () => {
    const evt = makeOkEvent("1", "uid-abc");
    const next = dispatch(initialState, { type: "EVENT_SELECTED", payload: evt.data as KubeEvent });
    expect(next.selectedEvent).toBe(evt.data);
    expect(next.selectedUid).toBe("uid-abc");
  });

  it("clears selectedEvent on EVENT_CLOSED", () => {
    const selected: EventsState = {
      ...initialState,
      selectedEvent: (makeOkEvent("1").data as KubeEvent),
      selectedUid: "uid-abc",
    };
    const next = dispatch(selected, { type: "EVENT_CLOSED" });
    expect(next.selectedEvent).toBeNull();
    expect(next.selectedUid).toBeNull();
  });
});

describe("eventsReducer — NAVIGATE_PREV / NAVIGATE_NEXT", () => {
  const uid = "uid-nav";
  const e1 = makeOkEvent("e1", uid);
  const e2 = makeOkEvent("e2", uid);
  const e3 = makeOkEvent("e3", uid);
  // store is newest-first, so the chronological sequence e1 -> e2 -> e3 is
  // held as [e3, e2, e1]; getUidEvents reverses it back to chronological
  const state: EventsState = {
    ...initialState,
    events: [e3, e2, e1],
    selectedEvent: e2.data as KubeEvent,
    selectedUid: uid,
  };

  it("navigates to previous sibling", () => {
    const next = dispatch(state, { type: "NAVIGATE_PREV" });
    expect(next.selectedEvent?.id).toBe("e1");
  });

  it("navigates to next sibling", () => {
    const next = dispatch(state, { type: "NAVIGATE_NEXT" });
    expect(next.selectedEvent?.id).toBe("e3");
  });

  it("does not go before first sibling", () => {
    const atFirst: EventsState = { ...state, selectedEvent: e1.data as KubeEvent };
    const next = dispatch(atFirst, { type: "NAVIGATE_PREV" });
    expect(next).toBe(atFirst);
  });

  it("does not go past last sibling", () => {
    const atLast: EventsState = { ...state, selectedEvent: e3.data as KubeEvent };
    const next = dispatch(atLast, { type: "NAVIGATE_NEXT" });
    expect(next).toBe(atLast);
  });

  it("is a no-op when no event is selected", () => {
    const next = dispatch(initialState, { type: "NAVIGATE_NEXT" });
    expect(next).toBe(initialState);
  });
});
