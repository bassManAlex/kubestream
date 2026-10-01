// Runs Playwright with config.json prepared first (restarts off, medium rate)
// and put back afterwards, also on failure or Ctrl+C. On a clean clone the
// file is created from config.example.json and removed at the end.
// globalSetup won't do: Playwright may start the webServers before it.
import { readFile, writeFile, rm, copyFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(here, "..", "..", "config.json");
const EXAMPLE_PATH = resolve(here, "..", "..", "config.example.json");
const BACKUP_PATH = `${CONFIG_PATH}.e2e-backup`;
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
// run the CLI directly rather than through npx, whose shell shim would not
// pass a forwarded signal on to Playwright
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve(
  "@playwright/test/cli",
);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const existed = await exists(CONFIG_PATH);

async function restore() {
  if (!existed) {
    await rm(CONFIG_PATH, { force: true });
  } else if (await exists(BACKUP_PATH)) {
    await writeFile(CONFIG_PATH, await readFile(BACKUP_PATH, "utf8"));
  }
  await rm(BACKUP_PATH, { force: true });
}

let child = null;
let receivedSignal = null;

// Playwright takes SIGINT as a graceful stop (and ignores repeats within 1s).
// Restore only after it exits, so the backend can't write config.json again.
for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
  process.on(signal, () => {
    if (receivedSignal) return;
    receivedSignal = signal;
    child?.kill("SIGINT");
  });
}

let status = 1;
try {
  if (!existed) await copyFile(EXAMPLE_PATH, CONFIG_PATH);
  const original = await readFile(CONFIG_PATH, "utf8");
  await writeFile(BACKUP_PATH, original);

  const config = JSON.parse(original);
  config.serverRestartIntervalSeconds = 0;
  config.rate = "medium";
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

  if (!receivedSignal) {
    status = await new Promise((resolveStatus, reject) => {
      const args = [PLAYWRIGHT_CLI, "test", ...process.argv.slice(2)];
      child = spawn(process.execPath, args, {
        stdio: "inherit",
        cwd: resolve(here, ".."),
      });
      child.on("error", reject);
      child.on("exit", (code) => resolveStatus(code ?? 1));
    });
  }
} finally {
  await restore();
}

process.exit(receivedSignal ? SIGNAL_EXIT_CODES[receivedSignal] : status);
