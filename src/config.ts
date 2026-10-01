// config.json at the repo root, created from config.example.json on first
// start. A patch is validated, applied in memory, then written back.

import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT = new URL("../", import.meta.url);
const CONFIG_FILE = fileURLToPath(new URL("config.json", ROOT));
const EXAMPLE_FILE = fileURLToPath(new URL("config.example.json", ROOT));

export const RATES = ["slow", "medium", "fast", "ludicrous"] as const;

const probability = z.number().min(0).max(1);

export const ConfigSchema = z.strictObject({
  rate: z.enum(RATES),
  spikeProbability: probability,
  malformedProbability: probability,
  serverRestartIntervalSeconds: z.number().min(0).max(86_400),
});

const PatchSchema = ConfigSchema.partial();

export type Config = z.infer<typeof ConfigSchema>;
export type Rate = Config["rate"];

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`invalid config: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

function describe(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0
      ? `${issue.path.join(".")}: ${issue.message}`
      : issue.message,
  );
}

let current: Config | null = null;
let persist = true;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<(config: Config) => void>();

export async function load(): Promise<Config> {
  if (!existsSync(CONFIG_FILE)) await copyFile(EXAMPLE_FILE, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  } catch (error) {
    throw new ConfigError([`config.json is not valid JSON (${String(error)})`]);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(describe(parsed.error));
  current = parsed.data;
  return current;
}

export function get(): Config {
  if (!current) throw new Error("config used before load()");
  return current;
}

// Rejects the whole patch if any field is unknown or out of range.
export async function patch(input: unknown): Promise<Config> {
  const parsed = PatchSchema.safeParse(input);
  if (!parsed.success) throw new ConfigError(describe(parsed.error));
  const next: Config = { ...get(), ...parsed.data };
  current = next;
  for (const listener of listeners) listener(next);
  if (!persist) return next;
  // queued so patches reach disk in order; tmp + rename so a crash never
  // leaves half a file
  writes = writes
    .catch(() => {})
    .then(async () => {
      const tmp = `${CONFIG_FILE}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(tmp, CONFIG_FILE);
    });
  await writes;
  return next;
}

export function onChange(listener: (config: Config) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Test hook: sets the in-memory config and keeps later patches off disk.
export function setForTesting(config: Config): void {
  current = config;
  persist = false;
}
