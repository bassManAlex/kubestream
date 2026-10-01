import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvent } from "./catalog.ts";
import { corrupt, strategiesForTesting } from "./corrupt.ts";
import { RATES } from "./config.ts";
import { BUFFER_CAPACITY } from "./feed.ts";
// the frontend's own schema: the server must produce what the viewer accepts
import {
  KubeEventSchema,
  MAX_EVENTS,
  RATES as VIEWER_RATES,
} from "../app/src/types.ts";

const SAMPLES = 3000;

test("every generated event matches the frontend schema", () => {
  for (let i = 0; i < SAMPLES; i += 1) {
    const event = buildEvent(`test-${i}`);
    const result = KubeEventSchema.safeParse(JSON.parse(JSON.stringify(event)));
    assert.ok(result.success, JSON.stringify(result.error?.issues));
  }
});

test("events for the same object share uid, name and kind", () => {
  const byUid = new Map<string, string>();
  for (let i = 0; i < SAMPLES; i += 1) {
    const { involvedObject: o } = buildEvent(`test-${i}`);
    const identity = `${o.kind}/${o.namespace}/${o.name}`;
    assert.equal(byUid.get(o.uid) ?? identity, identity);
    byUid.set(o.uid, identity);
  }
  // a bounded population, so objects repeat and prev/next has siblings
  assert.ok(byUid.size < SAMPLES / 10);
});

test("each corruption strategy always yields invalid JSON", () => {
  for (const [index, strategy] of strategiesForTesting.entries()) {
    for (let i = 0; i < SAMPLES; i += 1) {
      const broken = strategy(JSON.stringify(buildEvent(`test-${i}`)));
      assert.throws(() => JSON.parse(broken), SyntaxError, `strategy ${index}`);
    }
  }
});

test("corrupt changes the payload", () => {
  const json = JSON.stringify(buildEvent("test"));
  assert.notEqual(corrupt(json), json);
});

test("the viewer offers the same rates the server accepts", () => {
  assert.deepEqual(VIEWER_RATES, RATES);
});

// smaller, and a client behind by more than the buffer would show a hole
test("the server buffers at least as many events as the viewer shows", () => {
  assert.ok(BUFFER_CAPACITY >= MAX_EVENTS);
});
