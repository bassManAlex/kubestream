// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistedEvents } from "./usePersistedEvents";
import { initialState } from "../store/eventsReducer";
import type { EventsState } from "../store/eventsReducer";
import type { EventSnapshot } from "../services/eventStore";
import { loadSnapshot, saveSnapshot } from "../services/eventStore";

// eventStore is mocked; fake timers drive the throttle.
vi.mock("../services/eventStore");

const loadMock = vi.mocked(loadSnapshot);
const saveMock = vi.mocked(saveSnapshot);

// builds a state holding events evt_1..evt_n (newest first) with the cursor at evt_n
function stateWith(n: number): EventsState {
  const events = Array.from({ length: n }, (_, i) => ({
    status: "malformed" as const,
    raw: "{}",
    id: `evt_${n - i}`,
  }));
  return { ...initialState, events, cursor: n > 0 ? `evt_${n}` : null };
}

function lastSaved(): EventSnapshot | undefined {
  return saveMock.mock.calls.at(-1)?.[0];
}

function renderPersisted(state: EventsState) {
  return renderHook(
    (props: { state: EventsState }) => usePersistedEvents(props.state),
    {
      initialProps: { state },
    },
  );
}

// renders the hook and lets the (immediately resolved) initial load settle
async function renderLoaded(state: EventsState = stateWith(0)) {
  const hook = renderPersisted(state);
  await act(async () => {});
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  loadMock.mockReset();
  loadMock.mockResolvedValue(null);
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePersistedEvents", () => {
  it("keeps saving while events arrive faster than the persist interval", async () => {
    const { rerender, unmount } = await renderLoaded();

    // 10 updates per second for 5 seconds
    for (let n = 1; n <= 50; n++) {
      await act(async () => {
        rerender({ state: stateWith(n) });
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(saveMock.mock.calls.length).toBeGreaterThanOrEqual(4);

    // the trailing save carries the last state
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(lastSaved()?.cursor).toBe("evt_50");
    expect(lastSaved()?.events).toHaveLength(50);

    unmount();
  });

  it("does not write before the initial load resolves", async () => {
    let resolveLoad: (snapshot: EventSnapshot | null) => void = () => {};
    loadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const { rerender, result } = renderPersisted(stateWith(0));
    for (let n = 1; n <= 30; n++) {
      await act(async () => {
        rerender({ state: stateWith(n) });
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(result.current).toBeUndefined();
    expect(saveMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad(null);
    });
    expect(result.current).toEqual({ events: [], cursor: null });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(lastSaved()?.cursor).toBe("evt_30");
  });

  it("saves immediately on pagehide", async () => {
    const { rerender } = await renderLoaded();

    await act(async () => {
      rerender({ state: stateWith(3) });
    });
    expect(saveMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(lastSaved()?.cursor).toBe("evt_3");

    // already written, the timer has nothing left
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("saves immediately when the page becomes hidden", async () => {
    const { rerender } = await renderLoaded();

    await act(async () => {
      rerender({ state: stateWith(2) });
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(lastSaved()?.cursor).toBe("evt_2");
  });

  it("flushes the pending save on unmount", async () => {
    const { rerender, unmount } = await renderLoaded();

    await act(async () => {
      rerender({ state: stateWith(4) });
    });
    expect(saveMock).not.toHaveBeenCalled();

    unmount();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(lastSaved()?.cursor).toBe("evt_4");
  });
});
