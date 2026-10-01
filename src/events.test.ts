import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvent } from "./catalog.ts";
import { corrupt, strategiesForTesting } from "./corrupt.ts";
// the frontend's own schema: the server must produce what the viewer accepts
import { KubeEventSchema } from "../app/src/types.ts";

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

test("every namespace shows up in the first events", () => {
  const namespaces = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    namespaces.add(buildEvent(`test-${i}`).involvedObject.namespace);
  }
  for (const namespace of ["default", "kube-system", "payments", "batch"]) {
    assert.ok(namespaces.has(namespace), namespace);
  }
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
