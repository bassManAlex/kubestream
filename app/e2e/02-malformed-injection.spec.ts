import { test, expect } from "@playwright/test";
import { patchConfig } from "./helpers";

test.afterEach(async () => {
  // restore defaults so later tests in the same run aren't affected
  await patchConfig({ malformedProbability: 0.02, rate: "slow" });
});

test("malformed events are surfaced as a counter and never crash the UI", async ({ page }) => {
  await patchConfig({ rate: "fast", malformedProbability: 0.5 });

  await page.goto("/");
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15_000 });

  // wait for the malformed counter to move off zero — at 50% malformed
  // probability and fast rate this should happen within a couple seconds
  const malformedCounter = page.getByText(/\d+ malformed/);
  await expect(malformedCounter).toBeVisible({ timeout: 15_000 });

  // the error boundary's fallback ("Something went wrong...") must never appear
  await expect(page.getByText("Something went wrong rendering the stream")).toHaveCount(0);

  // the list keeps rendering rows (malformed ones show a placeholder row)
  await expect(page.locator("text=malformed event").first()).toBeVisible({ timeout: 10_000 });
});
