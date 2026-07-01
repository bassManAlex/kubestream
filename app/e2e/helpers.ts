import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const BACKEND_URL = "http://localhost:4100";
export const CONFIG_BACKUP_PATH = resolve(here, "..", "..", "config.json.e2e-backup");

// The shared backend can be mid-restart (5s down window, see src/index.ts)
// right when a test's afterEach fires — retry instead of failing the suite
// over a transient connection refusal.
export async function patchConfig(body: Record<string, unknown>): Promise<void> {
  const attempts = 8;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BACKEND_URL}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH /config failed: ${res.status}`);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
