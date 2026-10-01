import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";

// This one kills a backend for real, so it uses its own pair (backend 4101,
// frontend 5181) and leaves the shared one alone.
const BACKEND_PORT = 4101;
const FRONTEND_URL = "http://localhost:5181";

let backend: ChildProcess;

test.beforeAll(async () => {
  backend = spawn("pnpm", ["--dir", "..", "start"], {
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

test("reports Disconnected after repeated failed reconnects", async ({
  page,
}) => {
  await page.goto(FRONTEND_URL);

  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  killBackend();

  // failures at ~0, 1, 3 and 7s; the 4th shows Disconnected. Generous
  // timeout for slow CI machines.
  await expect(page.getByText("Disconnected", { exact: true })).toBeVisible({
    timeout: 45_000,
  });
});
