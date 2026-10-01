import assert from "node:assert/strict";
import { test } from "node:test";
import { delay } from "./timing.ts";

const PENDING = Symbol("pending");

async function settledWithin(promise: Promise<void>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });
  const result = await Promise.race([promise.then(() => "settled"), timeout]);
  clearTimeout(timer);
  return result;
}

test("a delay beyond the 32-bit timer limit does not fire early", async () => {
  const controller = new AbortController();
  const waiting = delay(Number.MAX_SAFE_INTEGER, controller.signal);
  assert.equal(await settledWithin(waiting, 50), PENDING);
  controller.abort();
  assert.equal(await settledWithin(waiting, 50), "settled");
});

test("a delay resolves at once on an aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await settledWithin(delay(60_000, controller.signal), 10),
    "settled",
  );
});

test("an infinite delay waits for the signal", async () => {
  const controller = new AbortController();
  const waiting = delay(Number.POSITIVE_INFINITY, controller.signal);
  assert.equal(await settledWithin(waiting, 50), PENDING);
  controller.abort();
  assert.equal(await settledWithin(waiting, 50), "settled");
});
