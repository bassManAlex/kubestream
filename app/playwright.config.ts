import { defineConfig } from "@playwright/test";

const BACKEND_PORT = 4100;
const FRONTEND_PORT = 5180;
// dedicated frontend instance pointed at the disconnected-state spec's
// own (killable) backend on DISCONNECT_BACKEND_PORT — see that spec.
const DISCONNECT_FRONTEND_PORT = 5181;
const DISCONNECT_BACKEND_PORT = 4101;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // each test owns the backend's restart/rate config
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
  },
  webServer: [
    {
      command: `PORT=${BACKEND_PORT} npm run start --prefix ..`,
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_SERVER_URL: `http://localhost:${BACKEND_PORT}`,
      },
    },
    {
      command: `npx vite --port ${DISCONNECT_FRONTEND_PORT}`,
      url: `http://localhost:${DISCONNECT_FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_SERVER_URL: `http://localhost:${DISCONNECT_BACKEND_PORT}`,
      },
    },
  ],
});
