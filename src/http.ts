// Routes. A new app is built for each listener, so a simulated restart drops
// every connection while the feed keeps going.
//
//   GET   /health
//   GET   /events          ?since=<id>&limit=<1..2000>, default limit 100;
//                          gap: true when since is no longer buffered
//   GET   /events/stream   server-sent events, one payload per message
//   GET   /config
//   PATCH /config

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  ConfigError,
  get as getConfig,
  patch as patchConfig,
} from "./config.ts";
import { BUFFER_CAPACITY, type EventFeed } from "./feed.ts";

const DEFAULT_LIMIT = 100;
const KEEPALIVE_MS = 15_000;

function parseLimit(value: string | undefined): number {
  const limit = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(BUFFER_CAPACITY, Math.max(1, limit));
}

export function createApp(feed: EventFeed): Hono {
  const app = new Hono();
  const startedAt = Date.now();

  app.use("*", cors());

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.get("/events", (c) => {
    const since = c.req.query("since") || undefined;
    const { page, gap } = feed.read(since, parseLimit(c.req.query("limit")));
    return c.json({
      events: page.map((delivery) => delivery.payload),
      // with nothing newer, the caller's cursor comes back unchanged
      nextCursor: page.at(-1)?.id ?? since ?? null,
      gap,
    });
  });

  app.get("/events/stream", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = feed.subscribe((delivery) => {
        void stream
          .writeSSE({ id: delivery.id, data: delivery.payload })
          .catch(() => {});
      });
      // keeps idle proxies from closing the connection
      const keepalive = setInterval(() => {
        void stream.write(": keepalive\n\n").catch(() => {});
      }, KEEPALIVE_MS);

      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(keepalive);
      unsubscribe();
    }),
  );

  app.get("/config", (c) => c.json(getConfig()));

  app.patch("/config", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    try {
      return c.json(await patchConfig(body));
    } catch (error) {
      if (error instanceof ConfigError) {
        return c.json({ error: "invalid config", issues: error.issues }, 400);
      }
      throw error;
    }
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  return app;
}
