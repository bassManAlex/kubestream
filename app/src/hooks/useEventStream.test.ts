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

function okJson(id: string, uid = "uid-1"): string {
  return JSON.stringify({ id, involvedObject: { uid } });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function okIds(state: EventsState): string[] {
  return state.events.flatMap((e) => (e.status === "ok" ? [e.data.id] : []));
}

const fetchMock = vi.fn<typeof fetch>();

function renderStream() {
  return renderHook(() => {
    const [state, dispatch] = useReducer(eventsReducer, initialState);
    useEventStream(state, dispatch);
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
