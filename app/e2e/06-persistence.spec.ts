import { test, expect } from "@playwright/test";
import { eventCount, patchConfig } from "./helpers";

test.afterEach(async () => {
  await patchConfig({ rate: "slow" });
});

test("a reload restores the events from IndexedDB", async ({ page }) => {
  await patchConfig({ rate: "fast" });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // well past the 100 events a fresh start backfills
  await expect
    .poll(() => eventCount(page), { timeout: 30_000 })
    .toBeGreaterThan(300);

  // let the once a second save run, then reload
  await page.waitForTimeout(1500);
  const before = await eventCount(page);
  await page.reload();

  // without the snapshot it would restart from ~100 and need seconds to
  // catch up at ~30/s
  await expect
    .poll(() => eventCount(page), { timeout: 2_000 })
    .toBeGreaterThanOrEqual(before);
});
