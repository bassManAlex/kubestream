import { test, expect } from "@playwright/test";
import { eventCount, patchConfig } from "./helpers";

test.afterEach(async () => {
  await patchConfig({ rate: "slow" });
});

test("rows being read stay in place while new events arrive above", async ({
  page,
}) => {
  await patchConfig({ rate: "medium" });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => eventCount(page), { timeout: 30_000 })
    .toBeGreaterThan(150);

  const main = page.locator("main");
  const box = (await main.boundingBox())!;
  const rowUnderPoint = () =>
    page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x!, y!)?.closest("button")?.textContent ??
        null,
      [box.x + 200, box.y + 300],
    );

  // a single wheel gesture must be enough to leave the top
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.wheel(0, 800);
  const backToNewest = page.getByRole("button", { name: "↑ back to newest" });
  await expect(backToNewest).toBeVisible();

  // ~20 new rows in 2s at medium
  const reading = await rowUnderPoint();
  expect(reading).not.toBeNull();
  await page.waitForTimeout(2000);
  expect(await rowUnderPoint()).toBe(reading);

  await backToNewest.click();
  await expect(backToNewest).toBeHidden();
  const head = await page
    .locator("main button[aria-label]")
    .first()
    .textContent();
  await expect
    .poll(() => page.locator("main button[aria-label]").first().textContent(), {
      timeout: 10_000,
    })
    .not.toBe(head);
});
