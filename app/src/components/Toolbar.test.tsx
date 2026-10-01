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

function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
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
  render(<Toolbar {...props} />);
  return props;
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
