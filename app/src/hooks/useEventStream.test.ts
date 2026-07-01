// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducer } from "react";
import { useEventStream } from "./useEventStream";
import { eventsReducer, initialState } from "../store/eventsReducer";
import type { EventsState } from "../store/eventsReducer";

// jsdom ships no EventSource, so we drive a controllable fake and assert on
// what the hook does with it. Tests cover the three chaos regressions:
// multi-page catch-up drain (#1), in-order live/backfill merge (#2), and the
// reconnect timer being cleared on unmount (#3).

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emitOpen() {
    this.onopen?.();
  }
  emitMessage(data: string) {
    this.onmessage?.({ data });
  }
  emitError() {
    this.onerror?.();
  }
}

// a complete, schema-valid event payload (parseEvent now validates the full shape)
function okJson(id: string, uid = "uid-1"): string {
  return JSON.stringify({
    id,
    apiVersion: "v1",
    kind: "Event",
    metadata: {
      name: `evt-${id}`,
      namespace: "default",
      uid: `meta-${id}`,
      resourceVersion: "1",
      creationTimestamp: "2024-01-01T00:00:00Z",
    },
    involvedObject: {
      apiVersion: "v1",
      kind: "Pod",
      name: "my-pod",
      namespace: "default",
      uid,
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
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// store is newest-first; reverse to read chronologically in assertions
function okIds(state: EventsState): string[] {
  return state.events.flatMap((e) => (e.status === "ok" ? [e.data.id] : [])).reverse();
}

const fetchMock = vi.fn<typeof fetch>();

function renderStream() {
  return renderHook(() => {
    const [state, dispatch] = useReducer(eventsReducer, initialState);
    useEventStream(state, dispatch, null);
    return state;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useEventStream", () => {
  it("drains every page of a multi-page gap on reconnect (bug #1)", async () => {
    // initial backfill is empty; one live event seeds the cursor at evt_1
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input), "http://localhost");
      const since = url.searchParams.get("since");
      if (since === "evt_1") {
        const events = Array.from({ length: 100 }, (_, i) => okJson(`evt_${i + 2}`));
        return Promise.resolve(jsonResponse({ events, nextCursor: "evt_101" }));
      }
      if (since === "evt_101") {
        const events = Array.from({ length: 49 }, (_, i) => okJson(`evt_${i + 102}`));
        return Promise.resolve(jsonResponse({ events, nextCursor: "evt_150" }));
      }
      // initial backfill (no since) and the final echo both report nothing new
      return Promise.resolve(jsonResponse({ events: [], nextCursor: since }));
    });

    const { result } = renderStream();
    const es0 = MockEventSource.instances[0]!;

    await act(async () => {
      es0.emitOpen();
    });
    await act(async () => {
      es0.emitMessage(okJson("evt_1"));
    });

    // drop the connection and let the 3s reconnect fire
    await act(async () => {
      es0.emitError();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    const es1 = MockEventSource.instances[1]!;

    await act(async () => {
      es1.emitOpen();
    });

    const ids = okIds(result.current);
    expect(ids).toHaveLength(150); // evt_1 (live) + 100 + 49 drained
    expect(ids.at(-1)).toBe("evt_150");
    expect(result.current.cursor).toBe("evt_150");
  });

  it("appends live events after the backfill, preserving order (bug #2)", async () => {
    let releaseDrain: (() => void) | null = null;

    fetchMock.mockImplementation((input) => {
      const since = new URL(String(input), "http://localhost").searchParams.get("since");
      if (since === "evt_10") {
        // hold the first drain page open until the test releases it
        return new Promise<Response>((resolve) => {
          releaseDrain = () =>
            resolve(
              jsonResponse({
                events: [okJson("evt_11"), okJson("evt_12"), okJson("evt_13")],
                nextCursor: "evt_13",
              }),
            );
        });
      }
      return Promise.resolve(jsonResponse({ events: [], nextCursor: since }));
    });

    const { result } = renderStream();
    const es0 = MockEventSource.instances[0]!;

    await act(async () => {
      es0.emitOpen(); // initial backfill (empty)
    });
    await act(async () => {
      es0.emitMessage(okJson("evt_10")); // seeds cursor at evt_10
    });

    await act(async () => {
      es0.emitError();
      await vi.advanceTimersByTimeAsync(3000);
    });
    const es1 = MockEventSource.instances[1]!;

    // open starts the drain (now pending); a live event arrives mid-catch-up
    await act(async () => {
      es1.emitOpen();
    });
    await act(async () => {
      es1.emitMessage(okJson("evt_50"));
    });
    // release the drain; the buffered live event must flush AFTER the gap
    await act(async () => {
      releaseDrain?.();
    });

    const ids = okIds(result.current);
    expect(ids).toEqual(["evt_10", "evt_11", "evt_12", "evt_13", "evt_50"]);
  });

  it("coalesces live events arriving in one frame into a single flush (perf #5)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));

    const { result } = renderStream();
    const es0 = MockEventSource.instances[0]!;
    await act(async () => {
      es0.emitOpen(); // initial backfill empty, cursor stays null
    });

    // three messages within the same frame: nothing is committed yet
    await act(async () => {
      es0.emitMessage(okJson("evt_a"));
      es0.emitMessage(okJson("evt_b"));
      es0.emitMessage(okJson("evt_c"));
    });
    expect(result.current.events).toHaveLength(0);

    // the animation frame flushes all three at once, in order
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(okIds(result.current)).toEqual(["evt_a", "evt_b", "evt_c"]);
    expect(result.current.cursor).toBe("evt_c");
  });

  it("backs off exponentially and reports Disconnected after repeated failures (#14/#9)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));
    const { result } = renderStream();
    const lastEs = () => MockEventSource.instances.at(-1)!;

    // attempt 1 -> base delay ~1000ms
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("reconnecting");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(MockEventSource.instances).toHaveLength(2);

    // attempt 2 -> delay doubled to ~2000ms: 1000ms is not enough to reconnect
    await act(async () => lastEs().emitError());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(MockEventSource.instances).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(MockEventSource.instances).toHaveLength(3);

    // attempts 3 and 4 -> still reconnecting, then Disconnected
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("reconnecting");
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("clears the reconnect timer on unmount, opening no new connection (bug #3)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));

    const { unmount } = renderStream();
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      MockEventSource.instances[0]!.emitError(); // schedules a 3s reconnect
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // the pending reconnect must have been cancelled
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
