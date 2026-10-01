import { test, expect } from "@playwright/test";
import {
  DEFAULT_MALFORMED_PROBABILITY,
  malformedCount,
  patchConfig,
} from "./helpers";

test.afterEach(async () => {
  await patchConfig({
    malformedProbability: DEFAULT_MALFORMED_PROBABILITY,
    rate: "slow",
  });
});

test("malformed events are surfaced as a counter and never crash the UI", async ({
  page,
}) => {
  await patchConfig({ rate: "fast", malformedProbability: 0.5 });

  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // The first catch-up already has a few malformed events, so the counter
  // must really climb: ~15/s here, ~1/s if the patch had no effect.
  const before = await malformedCount(page);
  await expect
    .poll(() => malformedCount(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before + 30);

  await expect(
    page.getByText("Something went wrong rendering the stream"),
  ).toHaveCount(0);

  await expect(page.getByText("malformed event").first()).toBeVisible({
    timeout: 10_000,
  });
});
