// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { Toolbar } from "./Toolbar";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

type Props = Parameters<typeof Toolbar>[0];

function renderToolbar(overrides: Partial<Props> = {}) {
  const props = {
    connectionStatus: "connected" as const,
    filter: "",
    onFilterChange: vi.fn(),
    paused: false,
    onTogglePause: vi.fn(),
    typeFilter: "all" as const,
    onTypeFilterChange: vi.fn(),
    namespaces: new Set<string>(),
    namespaceFilter: null,
    onNamespaceFilterChange: vi.fn(),
    reasons: new Set<string>(),
    reasonFilter: null,
    onReasonFilterChange: vi.fn(),
    ...overrides,
  };
  const view = render(<Toolbar {...props} />);
  // keeps the other props
  const rerender = (next: Partial<Props>) =>
    view.rerender(<Toolbar {...props} {...next} />);
  return { ...props, rerender };
}

const pressedRates = () =>
  ["slow", "medium", "fast", "ludicrous"].filter(
    (r) =>
      screen.getByRole("button", { name: r }).getAttribute("aria-pressed") ===
      "true",
  );

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Toolbar rate selector", () => {
  it("highlights no rate until the server reports one", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderToolbar();
    await act(async () => {});
    expect(pressedRates()).toEqual([]);
  });

  it("shows the rate reported by GET /config", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rate: "fast" }));
    renderToolbar();
    await act(async () => {});
    expect(pressedRates()).toEqual(["fast"]);
  });

  it("does not let a late failure undo a newer selection", async () => {
    let failFirst: (error: Error) => void = () => {};
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ rate: "slow" })) // GET /config
      .mockReturnValueOnce(
        new Promise<Response>((_, reject) => {
          failFirst = reject;
        }),
      ) // PATCH medium, fails later
      .mockResolvedValueOnce(jsonResponse({ rate: "fast" })); // PATCH fast
    renderToolbar();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "medium" }));
    fireEvent.click(screen.getByRole("button", { name: "fast" }));
    await act(async () => {
      failFirst(new Error("PATCH /config failed: 500"));
    });
    expect(pressedRates()).toEqual(["fast"]);
  });

  it("reverts to the previous rate when the server rejects the change", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ rate: "slow" }))
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response);
    renderToolbar();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ludicrous" }));
    });
    expect(pressedRates()).toEqual(["slow"]);
  });
});

describe("Toolbar rate refresh", () => {
  it("waits for the stream to connect, then reads the rate again on reconnect", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rate: "slow" }));
    const props = renderToolbar({ connectionStatus: "connecting" });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();

    props.rerender({ connectionStatus: "connected" });
    await act(async () => {});
    expect(pressedRates()).toEqual(["slow"]);

    fetchMock.mockResolvedValue(jsonResponse({ rate: "fast" }));
    props.rerender({ connectionStatus: "reconnecting" });
    props.rerender({ connectionStatus: "connected" });
    await act(async () => {});
    expect(pressedRates()).toEqual(["fast"]);
  });

  it("ignores an error response from GET /config", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);
    renderToolbar();
    await act(async () => {});
    expect(pressedRates()).toEqual([]);
  });
});

describe("Toolbar facet filters", () => {
  it("tells a namespace named all apart from the no-filter option", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const props = renderToolbar({ namespaces: new Set(["all", "default"]) });
    await act(async () => {});
    const select = screen.getByRole("combobox", {
      name: "Filter by namespace",
    });

    fireEvent.change(select, { target: { value: "=all" } });
    expect(props.onNamespaceFilterChange).toHaveBeenLastCalledWith("all");

    fireEvent.change(select, { target: { value: "" } });
    expect(props.onNamespaceFilterChange).toHaveBeenLastCalledWith(null);
  });
});
