import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";

// This scenario needs to kill the backend outright (not the simulated restart,
// which always comes back on its own). It targets the dedicated backend on
// DISCONNECT_BACKEND_PORT, paired with a frontend built against it in
// playwright.config.ts, so killing it doesn't disrupt the other specs that
// share the main backend/frontend pair.
const BACKEND_PORT = 4101;
const FRONTEND_URL = "http://localhost:5181";

let backend: ChildProcess;

test.beforeAll(async () => {
  backend = spawn("npm", ["run", "start", "--prefix", ".."], {
    env: { ...process.env, PORT: String(BACKEND_PORT) },
    stdio: "ignore",
    detached: true,
  });
  await expect
    .poll(
      async () => {
        try {
          const res = await fetch(`http://localhost:${BACKEND_PORT}/health`);
          return res.ok;
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

function killBackend() {
  if (backend.pid) {
    try {
      process.kill(-backend.pid, "SIGTERM");
    } catch {
      // process may have already exited
    }
  }
}

test.afterAll(() => {
  killBackend();
});

test("reports Disconnected after repeated failed reconnects", async ({ page }) => {
  await page.goto(FRONTEND_URL);

  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15_000 });

  killBackend();

  // backoff goes 1s, 2s, 4s, 8s before the 4th failure flips to Disconnected —
  // budget generously since CI machines are slower than the 30s cap implies
  await expect(page.getByText("Disconnected")).toBeVisible({ timeout: 45_000 });
});
