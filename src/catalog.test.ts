// Its own file, so it runs in a fresh process: the population is module
// state and the other tests fill it long before.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvent, NAMESPACES } from "./catalog.ts";

test("every namespace shows up in the first events", () => {
  const namespaces = new Set<string>();
  for (let i = 0; i < NAMESPACES.length; i += 1) {
    namespaces.add(buildEvent(`test-${i}`).involvedObject.namespace);
  }
  assert.deepEqual([...namespaces].sort(), [...NAMESPACES].sort());
});
