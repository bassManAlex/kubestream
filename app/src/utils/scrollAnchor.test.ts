import { describe, it, expect } from "vitest";
import { rowsPrepended } from "./scrollAnchor";

describe("rowsPrepended", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const d = { id: "d" };

  it("counts the rows inserted above the previous head", () => {
    expect(rowsPrepended([b, a], [d, c, b, a])).toBe(2);
  });

  it("still counts them when the tail was trimmed", () => {
    expect(rowsPrepended([b, a], [d, c, b])).toBe(2);
  });

  it("is 0 when nothing changed", () => {
    const rows = [b, a];
    expect(rowsPrepended(rows, rows)).toBe(0);
    expect(rowsPrepended(rows, [b, a])).toBe(0);
  });

  it("is 0 when the previous head is gone", () => {
    expect(rowsPrepended([b, a], [d, c])).toBe(0);
  });

  it("is 0 for an empty previous list", () => {
    expect(rowsPrepended([], [b, a])).toBe(0);
  });
});
