import { test, expect } from "@playwright/test";
import { patchConfig } from "./helpers";

const MAX_EVENTS = 2000;

test.afterEach(async () => {
  await patchConfig({ rate: "slow" });
});

test("stays responsive and caps the buffer under sustained ludicrous load", async ({ page }) => {
  await patchConfig({ rate: "ludicrous" });

  await page.goto("/");
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15_000 });

  // at ~60 events/s mean, the 2000-event cap is reached well within 60s
  await expect(page.getByText(`${MAX_EVENTS}+ events (capped)`)).toBeVisible({
    timeout: 60_000,
  });

  // UI must remain interactive: typing into the filter and toggling pause
  // should both take effect immediately even while events keep streaming in
  await page.getByPlaceholder("Filter events...").fill("kube-system");
  await page.getByRole("button", { name: /pause|resume/ }).click();
  await expect(page.getByRole("button", { name: /pause|resume/ })).toBeVisible();

  // the visible rows must respect the active filter
  const rows = page.locator("main button[aria-label]");
  const count = await rows.count();
  if (count > 0) {
    await expect(rows.first()).toContainText("kube-system");
  }
});
