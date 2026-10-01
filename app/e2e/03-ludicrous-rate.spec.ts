import { test, expect } from "@playwright/test";
import { patchConfig } from "./helpers";

const MAX_EVENTS = 2000;

test.afterEach(async () => {
  await patchConfig({ rate: "slow" });
});

test("stays responsive and caps the buffer under sustained ludicrous load", async ({
  page,
}) => {
  await patchConfig({ rate: "ludicrous" });

  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // ~60 events/s, so the cap comes well within 60s
  await expect(page.getByText(`${MAX_EVENTS}+ events (capped)`)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByPlaceholder("Filter events...").fill("kube-system");

  // virtualized rows come and go, so check them as a set
  const rows = page.locator("main button[aria-label]");
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: "kube-system" })).toHaveCount(0);
  expect(await rows.count()).toBeGreaterThan(0);

  // the newest row changes several times a second, unless paused
  const newestRow = () => rows.first().textContent();
  await page.getByRole("button", { name: "⏸ pause" }).click();
  const resume = page.getByRole("button", { name: "▶ resume" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  const frozen = await newestRow();
  await page.waitForTimeout(1500);
  expect(await newestRow()).toBe(frozen);

  await resume.click();
  await expect.poll(newestRow, { timeout: 10_000 }).not.toBe(frozen);
});
