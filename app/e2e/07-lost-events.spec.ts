import { test, expect } from "@playwright/test";
import { patchConfig } from "./helpers";

test.afterEach(async () => {
  await patchConfig({ rate: "slow" });
});

test("a pause longer than the server buffer reports the lost events", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await patchConfig({ rate: "ludicrous" });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const lost = page.getByText(/^events lost/);
  await page.getByRole("button", { name: "⏸ pause" }).click();
  // the server keeps 2000 events, ~60/s pushes the frozen cursor out in ~33s
  await page.waitForTimeout(42_000);
  await expect(lost).toHaveCount(0);

  await page.getByRole("button", { name: "▶ resume" }).click();
  await expect(lost).toHaveText("events lost once", { timeout: 10_000 });
});
