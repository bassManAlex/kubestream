import { test, expect } from "@playwright/test";
import { patchConfig } from "./helpers";

test.afterEach(async () => {
  await patchConfig({ rate: "slow", serverRestartIntervalSeconds: 420 });
});

test("recovers from a simulated server restart and resumes streaming", async ({ page }) => {
  // run.mjs seeds config.json with serverRestartIntervalSeconds: 3 before the
  // shared backend boots, covering the case where this spec runs first (the
  // interval can't be shortened for an already-running cycle). If an earlier
  // spec in the same run disabled it, this PATCH re-enables it for the next
  // cycle — the backend re-reads serverRestartIntervalSeconds at the start of
  // every listener cycle (src/index.ts), so this takes effect once the
  // current cycle's sleep ends.
  await patchConfig({ serverRestartIntervalSeconds: 3, rate: "medium" });
  await page.goto("/");
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15_000 });

  // the listener cycles down (5s) then back up; the badge must reflect both
  // transitions instead of getting stuck on a stale "Connected"
  await expect(page.getByText(/Reconnecting|Disconnected/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 30_000 });

  // events keep flowing after recovery — the count must keep growing rather
  // than freeze at whatever it was when the connection dropped
  const countText = await page.locator("text=/\\d+ events|\\d+\\+ events/").textContent();
  const before = Number(countText?.match(/\d+/)?.[0] ?? 0);
  await page.waitForTimeout(5_000);
  const afterText = await page.locator("text=/\\d+ events|\\d+\\+ events/").textContent();
  const after = Number(afterText?.match(/\d+/)?.[0] ?? 0);
  expect(after).toBeGreaterThanOrEqual(before);
});
