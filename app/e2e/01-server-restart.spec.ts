import { test, expect } from "@playwright/test";
import { eventCount, patchConfig } from "./helpers";

test.afterEach(async () => {
  await patchConfig({ rate: "slow", serverRestartIntervalSeconds: 0 });
});

test("recovers from a simulated server restart and resumes streaming", async ({
  page,
}) => {
  // restarts are off at boot (run.mjs), so the first connect is stable
  await patchConfig({ serverRestartIntervalSeconds: 0, rate: "medium" });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // 1s mean: a restart within a few seconds
  await patchConfig({ serverRestartIntervalSeconds: 1 });

  // down for 5s, the badge must leave "Connected"
  await expect(page.getByText(/^(Reconnecting|Disconnected)$/)).toBeVisible({
    timeout: 30_000,
  });

  // patchConfig retries until the listener is back. One more restart may
  // sneak in first; the client copes with that too.
  await patchConfig({ serverRestartIntervalSeconds: 0 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // and events keep coming (~10/s at medium)
  const before = await eventCount(page);
  await expect
    .poll(() => eventCount(page), { timeout: 15_000 })
    .toBeGreaterThan(before);
});
