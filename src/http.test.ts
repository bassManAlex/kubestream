import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { get as getConfig, setForTesting } from "./config.ts";
import { BUFFER_CAPACITY, EventFeed } from "./feed.ts";
import { createApp } from "./http.ts";

interface Page {
  events: string[];
  nextCursor: string | null;
  gap: boolean;
}

let feed: EventFeed;

beforeEach(() => {
  setForTesting({
    rate: "slow",
    spikeProbability: 0,
    malformedProbability: 0,
    serverRestartIntervalSeconds: 0,
  });
  feed = new EventFeed();
});

const ids = (page: Page) =>
  page.events.map((payload) => (JSON.parse(payload) as { id: string }).id);

async function getPage(query: string): Promise<Page> {
  const res = await createApp(feed).request(`/events${query}`);
  assert.equal(res.status, 200);
  return (await res.json()) as Page;
}

test("GET /events returns the latest events, oldest first", async () => {
  const emitted = Array.from({ length: 5 }, () => feed.emit().id);
  const page = await getPage("?limit=3");
  assert.deepEqual(ids(page), emitted.slice(2));
  assert.equal(page.nextCursor, emitted[4]);
});

test("GET /events?since pages forward from the cursor", async () => {
  const emitted = Array.from({ length: 10 }, () => feed.emit().id);
  const first = await getPage(`?since=${emitted[1]}&limit=4`);
  assert.deepEqual(ids(first), emitted.slice(2, 6));
  const second = await getPage(`?since=${first.nextCursor}&limit=4`);
  assert.deepEqual(ids(second), emitted.slice(6, 10));
});

test("GET /events echoes the cursor when nothing is newer", async () => {
  const last = Array.from({ length: 3 }, () => feed.emit().id).at(-1);
  const page = await getPage(`?since=${last}`);
  assert.deepEqual(page, { events: [], nextCursor: last, gap: false });
});

test("GET /events with an unknown cursor starts from the oldest event", async () => {
  const emitted = Array.from({ length: 3 }, () => feed.emit().id);
  const page = await getPage("?since=gone-42");
  assert.deepEqual(ids(page), emitted);
  assert.equal(page.gap, true);
});

test("GET /events flags no gap for a known cursor or no cursor", async () => {
  const emitted = Array.from({ length: 3 }, () => feed.emit().id);
  assert.equal((await getPage(`?since=${emitted[0]}`)).gap, false);
  assert.equal((await getPage("")).gap, false);
});

test("GET /events flags no gap before anything is buffered", async () => {
  const page = await getPage("?since=gone-42");
  assert.deepEqual(page, { events: [], nextCursor: "gone-42", gap: false });
});

test("an evicted cursor is reported as a gap", async () => {
  const first = feed.emit().id;
  for (let i = 0; i < BUFFER_CAPACITY; i += 1) feed.emit();
  const page = await getPage(`?since=${first}&limit=1`);
  assert.equal(page.gap, true);
  // the next page picks up from a buffered cursor: no gap again
  assert.equal((await getPage(`?since=${page.nextCursor}`)).gap, false);
});

test("the ring buffer keeps only the most recent events", async () => {
  const emitted = Array.from(
    { length: BUFFER_CAPACITY + 5 },
    () => feed.emit().id,
  );
  const page = await getPage(`?limit=${BUFFER_CAPACITY}`);
  assert.equal(page.events.length, BUFFER_CAPACITY);
  assert.equal(ids(page)[0], emitted[5]);
});

test("PATCH /config applies a valid partial update", async () => {
  const res = await createApp(feed).request("/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rate: "fast", malformedProbability: 0.5 }),
  });
  assert.equal(res.status, 200);
  assert.equal(getConfig().rate, "fast");
  assert.equal(getConfig().malformedProbability, 0.5);
});

test("PATCH /config rejects invalid values and leaves the config alone", async () => {
  for (const body of [
    { rate: "warp" },
    { malformedProbability: 2 },
    { unknownSetting: true },
  ]) {
    const res = await createApp(feed).request("/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(getConfig().rate, "slow");
});

test("PATCH /config rejects a body that is not JSON", async () => {
  const res = await createApp(feed).request("/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{rate:",
  });
  assert.equal(res.status, 400);
});

test("GET /health answers", async () => {
  const res = await createApp(feed).request("/health");
  assert.equal(res.status, 200);
});

test("the stream delivers each event with its id", async () => {
  const res = await createApp(feed).request("/events/stream");
  const reader = res.body!.getReader();
  const event = feed.emit();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, new RegExp(`id: ${event.id}`));
  assert.ok(text.includes(`data: ${event.payload}`));
  await reader.cancel();
});

test("concurrent PATCH /config requests all apply, in order", async () => {
  const app = createApp(feed);
  const send = (body: object) =>
    app.request("/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const responses = await Promise.all([
    send({ rate: "fast" }),
    send({ malformedProbability: 0.2 }),
    send({ rate: "ludicrous" }),
  ]);
  assert.deepEqual(
    responses.map((res) => res.status),
    [200, 200, 200],
  );
  assert.equal(getConfig().rate, "ludicrous");
  assert.equal(getConfig().malformedProbability, 0.2);
});
