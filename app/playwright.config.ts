import { defineConfig } from "@playwright/test";

const BACKEND_PORT = 4100;
const FRONTEND_PORT = 5180;
// second frontend, pointed at the backend the disconnect spec kills
const DISCONNECT_FRONTEND_PORT = 5181;
const DISCONNECT_BACKEND_PORT = 4101;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // each test owns the backend's restart/rate config
  workers: 1,
  timeout: 60_000,
  // CI also writes an HTML report, uploaded when a run fails
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
  },
  webServer: [
    {
      command: `PORT=${BACKEND_PORT} pnpm --dir .. start`,
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `pnpm exec vite --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_SERVER_URL: `http://localhost:${BACKEND_PORT}`,
      },
    },
    {
      command: `pnpm exec vite --port ${DISCONNECT_FRONTEND_PORT}`,
      url: `http://localhost:${DISCONNECT_FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_SERVER_URL: `http://localhost:${DISCONNECT_BACKEND_PORT}`,
      },
    },
  ],
});
