// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducer } from "react";
import { useEventStream } from "./useEventStream";
import { eventsReducer, initialState } from "../store/eventsReducer";
import type { EventsAction, EventsState } from "../store/eventsReducer";
import { EventStreamClient } from "../services/eventStream";

// jsdom has no EventSource, so the tests drive a fake one.

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string; lastEventId: string }) => void) | null =
    null;
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
  // lastEventId mirrors the `id:` field the server sends on every SSE message
  emitMessage(data: string, lastEventId = "") {
    this.onmessage?.({ data, lastEventId });
  }
  emitError() {
    this.onerror?.();
  }
}

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
  return state.events
    .flatMap((e) => (e.status === "ok" ? [e.data.id] : []))
    .reverse();
}

function malformedIds(state: EventsState): string[] {
  return state.events
    .flatMap((e) => (e.status === "malformed" ? [e.id] : []))
    .reverse();
}

const fetchMock = vi.fn<typeof fetch>();

let dispatchAction: React.Dispatch<EventsAction> = () => {};

function renderStream(initialCursor: string | null = null) {
  return renderHook(() => {
    const [state, dispatch] = useReducer(eventsReducer, initialState);
    dispatchAction = dispatch;
    useEventStream(state, dispatch, initialCursor);
    return state;
  });
}

async function togglePause() {
  await act(async () => {
    dispatchAction({ type: "TOGGLE_PAUSE" });
  });
}

interface Entry {
  id: string;
  payload: string;
}

const ok = (id: string): Entry => ({ id, payload: okJson(id) });
const bad = (id: string): Entry => ({ id, payload: `{"id":"${id}",` });

// Fake GET /events over a ring buffer, same `since` rules as the server.
// pageSize forces page boundaries, hold()/release() park one response,
// failOn(n) fails request n. After 50 requests everything fails, so a
// runaway loop ends the test instead of hanging it.
function ringServer(entries: Entry[], pageSize = 100) {
  const sinces: (string | null)[] = [];
  const held: (() => void)[] = [];
  const failing = new Set<number>();
  let holdNext = false;

  const page = (since: string | null, limit: number) => {
    const size = Math.min(limit, pageSize);
    let slice: Entry[];
    let gap = false;
    if (since) {
      const idx = entries.findIndex((e) => e.id === since);
      slice = (idx >= 0 ? entries.slice(idx + 1) : entries).slice(0, size);
      gap = idx < 0 && slice.length > 0;
    } else {
      slice = entries.slice(-size);
    }
    return {
      events: slice.map((e) => e.payload),
      nextCursor: slice.at(-1)?.id ?? since ?? null,
      gap,
    };
  };

  fetchMock.mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    const since = url.searchParams.get("since");
    sinces.push(since);
    if (sinces.length > 50 || failing.has(sinces.length - 1)) {
      return Promise.resolve({ ok: false } as unknown as Response);
    }
    const body = page(since, Number(url.searchParams.get("limit") ?? 100));
    if (!holdNext) return Promise.resolve(jsonResponse(body));
    holdNext = false;
    return new Promise<Response>((resolve) => {
      held.push(() => resolve(jsonResponse(body)));
    });
  });

  return {
    entries,
    sinces,
    hold: () => {
      holdNext = true;
    },
    failOn: (request: number) => {
      failing.add(request);
    },
    release: async () => {
      await act(async () => {
        held.shift()?.();
      });
    },
  };
}

// appended to the buffer and pushed over SSE
function live(es: MockEventSource, server: { entries: Entry[] }, entry: Entry) {
  server.entries.push(entry);
  es.emitMessage(entry.payload, entry.id);
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
  it("drains every page of a multi-page gap on reconnect", async () => {
    // initial backfill is empty; one live event seeds the cursor at evt_1
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input), "http://localhost");
      const since = url.searchParams.get("since");
      if (since === "evt_1") {
        const events = Array.from({ length: 100 }, (_, i) =>
          okJson(`evt_${i + 2}`),
        );
        return Promise.resolve(jsonResponse({ events, nextCursor: "evt_101" }));
      }
      if (since === "evt_101") {
        const events = Array.from({ length: 49 }, (_, i) =>
          okJson(`evt_${i + 102}`),
        );
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

    // drop the connection and let the reconnect fire (1s backoff, plus slack)
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

  it("appends live events after the backfill, preserving order", async () => {
    let releaseDrain: (() => void) | null = null;

    fetchMock.mockImplementation((input) => {
      const since = new URL(String(input), "http://localhost").searchParams.get(
        "since",
      );
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

  it("coalesces live events arriving in one frame into a single flush", async () => {
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

  it("backs off exponentially and reports Disconnected after repeated failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));
    const { result } = renderStream();
    const lastEs = () => MockEventSource.instances.at(-1)!;

    // attempt 1 -> base delay ~1000ms
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("reconnecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    // the retry itself does not flip the badge back to Connecting
    expect(result.current.connectionStatus).toBe("reconnecting");

    // attempt 2 -> delay doubled to ~2000ms: 1000ms is not enough to reconnect
    await act(async () => lastEs().emitError());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    // attempts 3 and 4 -> still reconnecting, then Disconnected
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("reconnecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await act(async () => lastEs().emitError());
    expect(result.current.connectionStatus).toBe("disconnected");

    // the client keeps retrying, and the badge stays Disconnected meanwhile
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(MockEventSource.instances).toHaveLength(5);
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("clears the reconnect timer on unmount, opening no new connection", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [], nextCursor: null }));

    const { unmount } = renderStream();
    expect(MockEventSource.instances).toHaveLength(1);

    await act(async () => {
      MockEventSource.instances[0]!.emitError(); // schedules a 1s reconnect
    });

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // the pending reconnect must have been cancelled
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("stops draining while paused, then resumes from the frozen cursor", async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ok(`evt_${i + 1}`));
    const server = ringServer(entries, 2);
    server.hold();

    const { result } = renderStream("evt_0");
    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.emitOpen(); // first page (evt_1, evt_2) is now in flight
    });
    expect(server.sinces).toEqual(["evt_0"]);

    await togglePause();
    await server.release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // no further page is requested while the pause holds
    expect(server.sinces).toEqual(["evt_0"]);
    expect(result.current.events).toHaveLength(0);

    await togglePause();
    expect(okIds(result.current)).toEqual(entries.map((e) => e.id));
    expect(result.current.cursor).toBe("evt_6");
  });

  it("advances past malformed events that end a page, without repeating them", async () => {
    const server = ringServer(
      [
        ok("evt_1"),
        ok("evt_2"),
        bad("evt_3"),
        bad("evt_4"),
        ok("evt_5"),
        ok("evt_6"),
      ],
      4,
    );

    const { result } = renderStream("evt_0");
    await act(async () => {
      MockEventSource.instances[0]!.emitOpen();
    });

    expect(server.sinces).toEqual(["evt_0", "evt_4", "evt_6"]);
    expect(okIds(result.current)).toEqual(["evt_1", "evt_2", "evt_5", "evt_6"]);
    expect(result.current.events).toHaveLength(6);
    expect(result.current.malformedCount).toBe(2);
    expect(malformedIds(result.current).at(-1)).toBe("evt_4");
    expect(result.current.cursor).toBe("evt_6");
  });

  it("drops live events already delivered by the catch-up page", async () => {
    const server = ringServer([
      ok("evt_10"),
      ok("evt_11"),
      bad("evt_12"),
      ok("evt_13"),
    ]);
    server.hold();

    const { result } = renderStream("evt_10");
    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.emitOpen(); // page since evt_10 is computed now: evt_11..evt_13
    });

    // the SSE subscription was already open: these overlap the REST page
    await act(async () => {
      es.emitMessage(bad("evt_12").payload, "evt_12");
      es.emitMessage(okJson("evt_13"), "evt_13");
      live(es, server, ok("evt_14"));
    });
    await server.release();
    expect(server.sinces).toEqual(["evt_10", "evt_13", "evt_14"]);

    await act(async () => {
      live(es, server, ok("evt_15"));
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(okIds(result.current)).toEqual([
      "evt_11",
      "evt_13",
      "evt_14",
      "evt_15",
    ]);
    expect(result.current.events).toHaveLength(5);
    expect(result.current.malformedCount).toBe(1);
    expect(result.current.cursor).toBe("evt_15");
  });

  it("backfills events dropped during a pause when it is lifted", async () => {
    const server = ringServer([ok("evt_1"), ok("evt_2")]);

    const { result } = renderStream("evt_0");
    const es = MockEventSource.instances[0]!;
    await act(async () => {
      es.emitOpen();
    });
    expect(okIds(result.current)).toEqual(["evt_1", "evt_2"]);
    const fetchesBeforePause = server.sinces.length;

    await togglePause();
    await act(async () => {
      live(es, server, ok("evt_3"));
      live(es, server, bad("evt_4"));
      live(es, server, ok("evt_5"));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(okIds(result.current)).toEqual(["evt_1", "evt_2"]);
    expect(result.current.cursor).toBe("evt_2");

    await togglePause();
    expect(server.sinces[fetchesBeforePause]).toBe("evt_2");
    expect(okIds(result.current)).toEqual(["evt_1", "evt_2", "evt_3", "evt_5"]);
    expect(result.current.events).toHaveLength(5);
    expect(result.current.cursor).toBe("evt_5");
  });

  it("reconnects instead of skipping a gap when a catch-up page fails", async () => {
    const server = ringServer([ok("evt_1"), ok("evt_2"), ok("evt_3")], 1);
    server.hold();
    server.failOn(1);

    const { result } = renderStream("evt_0");
    const es0 = MockEventSource.instances[0]!;
    await act(async () => {
      es0.emitOpen(); // first page (evt_1) is in flight
    });
    await act(async () => {
      live(es0, server, ok("evt_4")); // buffered behind the gap
    });
    await server.release(); // evt_1 lands, then the page after it fails

    // evt_4 must not be committed past the missing evt_2 and evt_3
    expect(okIds(result.current)).toEqual(["evt_1"]);
    expect(result.current.cursor).toBe("evt_1");
    expect(result.current.connectionStatus).toBe("reconnecting");
    expect(es0.closed).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const es1 = MockEventSource.instances[1]!;
    await act(async () => {
      es1.emitOpen();
    });

    expect(okIds(result.current)).toEqual(["evt_1", "evt_2", "evt_3", "evt_4"]);
    expect(result.current.cursor).toBe("evt_4");
    expect(result.current.connectionStatus).toBe("connected");
  });

  it("keeps backing off while the stream opens but the catch-up fails", async () => {
    fetchMock.mockResolvedValue({ ok: false } as unknown as Response);
    const { result } = renderStream("evt_0");
    const lastEs = () => MockEventSource.instances.at(-1)!;

    await act(async () => lastEs().emitOpen()); // catch-up fails: attempt 1
    expect(result.current.connectionStatus).toBe("reconnecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    // opening again does not reset the backoff: attempt 2 waits 2s
    await act(async () => lastEs().emitOpen());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("dispatches nothing once stopped while a catch-up fetch is in flight", async () => {
    const server = ringServer([ok("evt_1"), ok("evt_2")]);
    server.hold();
    const handlers = {
      onStatus: vi.fn(),
      onEvents: vi.fn(),
      onCursor: vi.fn(),
      onGap: vi.fn(),
      isPaused: () => false,
    };
    const client = new EventStreamClient("http://localhost", handlers, "evt_0");
    client.start();
    MockEventSource.instances[0]!.emitOpen();
    expect(server.sinces).toEqual(["evt_0"]);

    client.stop();
    await server.release();
    await vi.advanceTimersByTimeAsync(1000);

    expect(handlers.onEvents).not.toHaveBeenCalled();
    expect(handlers.onCursor).not.toHaveBeenCalled();
    expect(server.sinces).toEqual(["evt_0"]);
  });

  it("reports a gap once when the saved cursor is no longer buffered", async () => {
    const server = ringServer([ok("evt_5"), ok("evt_6"), ok("evt_7")], 2);
    const { result } = renderStream("evt_1"); // evicted long ago
    await act(async () => {
      MockEventSource.instances[0]!.emitOpen();
    });

    // the first page flags it, the next one starts from a buffered cursor
    expect(server.sinces).toEqual(["evt_1", "evt_6", "evt_7"]);
    expect(okIds(result.current)).toEqual(["evt_5", "evt_6", "evt_7"]);
    expect(result.current.gapCount).toBe(1);
  });

  it("reports no gap for a cursor the server still has", async () => {
    ringServer([ok("evt_1"), ok("evt_2")]);
    const { result } = renderStream("evt_1");
    await act(async () => {
      MockEventSource.instances[0]!.emitOpen();
    });
    expect(okIds(result.current)).toEqual(["evt_2"]);
    expect(result.current.gapCount).toBe(0);
  });

  it("counts one attempt when the stream and the catch-up fail together", async () => {
    let failFetch: (error: Error) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((_, reject) => {
          failFetch = reject;
        }),
    );
    const onStatus = vi.fn();
    const client = new EventStreamClient(
      "http://localhost",
      {
        onStatus,
        onEvents: vi.fn(),
        onCursor: vi.fn(),
        onGap: vi.fn(),
        isPaused: () => false,
      },
      "evt_0",
    );
    client.start();
    const es = MockEventSource.instances[0]!;
    es.emitOpen(); // catch-up page in flight

    // a restart drops the stream and the page request at once
    es.emitError();
    failFetch(new Error("connection reset"));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      onStatus.mock.calls.filter(([s]) => s === "reconnecting"),
    ).toHaveLength(1);

    // stopped before the retry: no connection may open afterwards
    client.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
