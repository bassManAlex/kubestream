// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EventModal } from "./EventModal";
import type { KubeEvent, ParsedEvent } from "../types";

function makeEvent(id: string): KubeEvent {
  return {
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
  };
}

function renderModal(onClose = vi.fn(), onPrev = vi.fn(), onNext = vi.fn()) {
  const event = makeEvent("evt_1");
  const events: ParsedEvent[] = [{ status: "ok", data: event }];
  const view = render(
    <EventModal
      event={event}
      uid="uid-1"
      events={events}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
    />,
  );
  return { dialog: screen.getByRole("dialog"), onClose, onPrev, onNext, view };
}

// a list row as EventList renders it, focused as after a click
function focusedRow(eventId: string): HTMLButtonElement {
  const row = document.createElement("button");
  row.dataset.eventId = eventId;
  document.body.append(row);
  row.focus();
  return row;
}

afterEach(cleanup);

describe("EventModal focus trap", () => {
  it("moves focus into the dialog on open", () => {
    const { dialog } = renderModal();
    expect(document.activeElement).toBe(dialog);
  });

  it("wraps Shift+Tab from the dialog container to the last control", () => {
    const { dialog } = renderModal();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    // prev and next are disabled with a single event, so close is the last
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close event detail" }),
    );
  });

  it("wraps Tab from the last control to the first", () => {
    const { dialog } = renderModal();
    screen.getByRole("button", { name: "Close event detail" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "copy yaml" }),
    );
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    const { dialog } = renderModal();
    screen.getByRole("button", { name: "copy yaml" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close event detail" }),
    );
  });
});

describe("EventModal backdrop", () => {
  it("closes on a click that starts and ends on the backdrop", () => {
    const { dialog, onClose } = renderModal();
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a text selection is dragged out of the dialog", () => {
    const { dialog, onClose } = renderModal();
    fireEvent.mouseDown(dialog.querySelector("pre")!);
    fireEvent.click(dialog.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open on a click inside the dialog", () => {
    const { dialog, onClose } = renderModal();
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("EventModal keyboard", () => {
  it("closes on Escape and moves with the arrow keys", () => {
    const { onClose, onPrev, onNext } = renderModal();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("EventModal focus on close", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("gives focus back to the row that opened it", () => {
    const row = focusedRow("evt_1");
    const { view } = renderModal();
    view.unmount();
    expect(document.activeElement).toBe(row);
  });

  it("follows the event when its row was recycled for another one", () => {
    const recycled = focusedRow("evt_1");
    const { view } = renderModal();
    recycled.dataset.eventId = "evt_9";
    const moved = document.createElement("button");
    moved.dataset.eventId = "evt_1";
    document.body.append(moved);
    view.unmount();
    expect(document.activeElement).toBe(moved);
  });

  it("leaves focus alone when the event scrolled out of the list", () => {
    const recycled = focusedRow("evt_1");
    const { view } = renderModal();
    recycled.dataset.eventId = "evt_9";
    view.unmount();
    expect(document.activeElement).not.toBe(recycled);
  });
});
