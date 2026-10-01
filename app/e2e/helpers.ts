import type { Page } from "@playwright/test";

export const BACKEND_URL = "http://localhost:4100";

// from config.example.json; specs put it back when done
export const DEFAULT_MALFORMED_PROBABILITY = 0.03;

// The shared backend may be in its 5s restart window, so keep retrying for
// a while instead of failing on a refused connection.
export async function patchConfig(
  body: Record<string, unknown>,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${BACKEND_URL}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH /config failed: ${res.status}`);
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

// header counters: "N events" or "2000+ events (capped)", and "N malformed"
// (hidden at 0)
export async function eventCount(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+\+? events/).textContent();
  return Number(text?.match(/\d+/)?.[0] ?? 0);
}

export async function malformedCount(page: Page): Promise<number> {
  const counter = page.getByText(/^\d+ malformed$/);
  if ((await counter.count()) === 0) return 0;
  return Number((await counter.textContent())?.match(/\d+/)?.[0] ?? 0);
}
