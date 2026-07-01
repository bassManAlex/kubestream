// Wraps `playwright test` so config.json carries a short
// serverRestartIntervalSeconds *before* the shared backend (started by
// playwright.config.ts's webServer) boots — the backend only reads that
// value once, at process start (src/index.ts), so a runtime PATCH /config
// can't shorten an already-scheduled restart. Playwright's own
// globalSetup/globalTeardown don't guarantee they run before webServer
// boots, so this wrapper does the swap outside Playwright entirely.
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(here, "..", "..", "config.json");
const BACKUP_PATH = `${CONFIG_PATH}.e2e-backup`;

const original = await readFile(CONFIG_PATH, "utf8");
await writeFile(BACKUP_PATH, original);

const config = JSON.parse(original);
config.serverRestartIntervalSeconds = 3;
config.rate = "medium";
await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

const result = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: resolve(here, ".."),
});

await writeFile(CONFIG_PATH, await readFile(BACKUP_PATH, "utf8"));
await rm(BACKUP_PATH, { force: true });

process.exit(result.status ?? 1);
