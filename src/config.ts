// config.json is created from config.example.json on first run.
// patch /config writes it back to disk and updates the in-memory copy.

import { readFile, writeFile, copyFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(here, '..', 'config.json')
const EXAMPLE_PATH = resolve(here, '..', 'config.example.json')

const RATES = ['slow', 'medium', 'fast', 'ludicrous'] as const

const ConfigSchema = z.strictObject({
  rate: z.enum(RATES),
  spikeProbability: z.number().min(0).max(1),
  malformedProbability: z.number().min(0).max(1),
  serverRestartIntervalSeconds: z.number().min(0).max(86_400),
})

export type Config = z.infer<typeof ConfigSchema>
export type Rate = Config['rate']

let current: Config | null = null

export class ConfigValidationError extends Error {
  constructor(source: string, errors: string[]) {
    super(`Invalid ${source}:\n- ${errors.join('\n- ')}`)
    this.name = 'ConfigValidationError'
  }
}

function validate(input: unknown, source: string): Config {
  const result = ConfigSchema.safeParse(input)
  if (result.success) return result.data

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'config'
    return `${path}: ${issue.message}`
  })
  throw new ConfigValidationError(source, errors)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

function sanitize(input: Partial<Config>, base: Config): Config {
  const m = { ...base, ...input }
  return {
    rate: RATES.includes(m.rate as Rate) ? (m.rate as Rate) : 'medium',
    spikeProbability: clamp(m.spikeProbability, 0, 1),
    malformedProbability: clamp(m.malformedProbability, 0, 1),
    serverRestartIntervalSeconds: clamp(m.serverRestartIntervalSeconds, 0, 86_400),
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function load(): Promise<Config> {
  if (!(await fileExists(CONFIG_PATH))) {
    await copyFile(EXAMPLE_PATH, CONFIG_PATH)
  }
  const raw = await readFile(CONFIG_PATH, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ConfigValidationError(CONFIG_PATH, [`must be valid JSON (${message})`])
  }
  current = validate(parsed, CONFIG_PATH)
  return current
}

export function get(): Config {
  if (!current) throw new Error('config not loaded; call load() first')
  return current
}

export async function update(patch: Partial<Config>): Promise<Config> {
  current = sanitize(patch, get())
  await writeFile(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8')
  return current
}
