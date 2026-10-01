// The feed lives for the whole process. The HTTP listener is restarted at
// random intervals to simulate a redeploy (serverRestartIntervalSeconds,
// 0 = never).

import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { get as getConfig, load as loadConfig, onChange } from "./config.ts";
import { EventFeed } from "./feed.ts";
import { createApp } from "./http.ts";
import { delay } from "./timing.ts";

const PORT = Number(process.env.PORT ?? 4000);
const DOWNTIME_MS = 5_000;

const log = (message: string) => console.log(`[kubestream] ${message}`);

function listen(feed: EventFeed): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: createApp(feed).fetch, port: PORT }, () => {
      log(`listening on http://localhost:${PORT}`);
      resolve(server as Server);
    }) as Server;
    server.once("error", reject);
  });
}

// drop open streams too, like a real redeploy
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

// Waits until the listener should go down. A config change restarts the
// wait with the new interval; the exponential is memoryless, so the restart
// rate stays right.
async function uptime(shutdown: AbortSignal): Promise<void> {
  while (!shutdown.aborted) {
    const changed = new AbortController();
    const unsubscribe = onChange(() => changed.abort());
    const mean = getConfig().serverRestartIntervalSeconds;
    let ms = Number.POSITIVE_INFINITY;
    if (mean > 0) {
      ms = -Math.log(1 - Math.random()) * mean * 1000;
      log(`next simulated restart in ${(ms / 1000).toFixed(1)}s`);
    }
    await delay(ms, AbortSignal.any([shutdown, changed.signal]));
    unsubscribe();
    if (!changed.signal.aborted) return;
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();
  log(`config ${JSON.stringify(config)}`);

  const feed = new EventFeed();
  feed.start();

  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      log(`${signal} received, shutting down`);
      controller.abort();
    });
  }

  while (!controller.signal.aborted) {
    const server = await listen(feed);
    await uptime(controller.signal);
    await close(server);
    if (controller.signal.aborted) break;
    log(`listener down for ${DOWNTIME_MS / 1000}s`);
    await delay(DOWNTIME_MS, controller.signal);
  }

  feed.stop();
  log("stopped");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(
    `[kubestream] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
