// alternate launcher: spawns the server as a child process, tails its stdout
// into a centered log box, polls /health + /config for status, and binds
// hotkeys that change `rate` by PATCHing /config. the http api is the only
// surface used to mutate config so the tui never reaches into shared state.

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  type CliRenderer,
  type KeyEvent,
} from '@opentui/core'

type Rate = 'slow' | 'medium' | 'fast' | 'ludicrous'
const RATES: Rate[] = ['slow', 'medium', 'fast', 'ludicrous']

type ServerStatus = 'starting' | 'up' | 'down'
type LineHandler = (line: string) => void

type Config = {
  rate: Rate
  spikeProbability: number
  malformedProbability: number
  serverRestartIntervalSeconds: number
}

const PORT = Number(process.env.PORT ?? 4000)
const BASE_URL = `http://localhost:${PORT}`
const SERVER_ID = 'log-stream-server'
const MAX_LOG_LINES = 500
const HEALTH_POLL_MS = 1000
const CONFIG_POLL_MS = 2000

const here = dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = resolve(here, 'index.ts')

const palette = {
  bg: '#0d1117',
  surface: '#161b22',
  border: '#30363d',
  borderAccent: '#58a6ff',
  text: '#c9d1d9',
  textDim: '#8b949e',
  good: '#3fb950',
  bad: '#f85149',
  warn: '#d29922',
  accent: '#bb9af7',
} as const

const state = {
  config: null as Config | null,
  serverStatus: 'starting' as ServerStatus,
  eventsSeen: 0,
  logLines: [] as string[],
  flash: null as { text: string; until: number } | null,
  lastError: null as string | null,
}

function spawnServer(): ChildProcess {
  const child = spawn('tsx', [SERVER_ENTRY], {
    cwd: resolve(here, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
}

// each line of server stdout is either a serialized event payload (json-ish) or
// a bracketed status line like "[server] listening on ...". we keep them all.
function appendLine(line: string): void {
  if (!line) return
  state.logLines.push(line)
  if (state.logLines.length > MAX_LOG_LINES) {
    state.logLines.splice(0, state.logLines.length - MAX_LOG_LINES)
  }
  // crude but works: a payload starts with { and isn't a meta line
  if (line.startsWith('{')) state.eventsSeen += 1
}

function appendBufferedLines(buffer: string, chunk: Buffer, handleLine: LineHandler): string {
  let nextBuffer = buffer + chunk.toString('utf8')
  let newlineIndex = nextBuffer.indexOf('\n')

  while (newlineIndex !== -1) {
    const line = nextBuffer.slice(0, newlineIndex)
    nextBuffer = nextBuffer.slice(newlineIndex + 1)
    if (line.length > 0) handleLine(line)
    newlineIndex = nextBuffer.indexOf('\n')
  }

  return nextBuffer
}

function pipeChild(child: ChildProcess): void {
  let stdoutBuffer = ''
  let stderrBuffer = ''

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer = appendBufferedLines(stdoutBuffer, chunk, appendLine)
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer = appendBufferedLines(stderrBuffer, chunk, (line) => appendLine(`[stderr] ${line}`))
  })

  child.on('exit', (code, signal) => {
    appendLine(`[tui] server exited code=${code} signal=${signal ?? '-'}`)
    state.serverStatus = 'down'
  })
}

type HealthProbe =
  | { kind: 'ours' }
  | { kind: 'foreign' } // something answered but it isn't us
  | { kind: 'none' } // nothing listening / unreachable

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function probeHealth(timeoutMs = 500): Promise<HealthProbe> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/health`, timeoutMs)
    if (!res.ok) return { kind: 'foreign' }
    return res.headers.get('x-log-stream-server') === SERVER_ID
      ? { kind: 'ours' }
      : { kind: 'foreign' }
  } catch {
    return { kind: 'none' }
  }
}

async function fetchHealth(): Promise<boolean> {
  const probe = await probeHealth()
  return probe.kind === 'ours'
}

async function fetchConfig(): Promise<Config | null> {
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/config`, 1000)
    if (!res.ok) return null
    return (await res.json()) as Config
  } catch {
    return null
  }
}

async function patchRate(next: Rate): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rate: next }),
    })
    if (!res.ok) {
      state.lastError = `PATCH /config -> ${res.status}`
      flash(`rate change failed (${res.status})`, 1500)
      return
    }
    state.config = (await res.json()) as Config
    state.lastError = null
    flash(`rate → ${next}`, 1200)
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err)
    flash(`rate change failed: ${state.lastError}`, 1500)
  }
}

function flash(text: string, ms: number): void {
  state.flash = { text, until: Date.now() + ms }
}

function currentRateIndex(): number {
  if (!state.config) return 0
  const i = RATES.indexOf(state.config.rate)
  return i >= 0 ? i : 0
}

function serverStatusLabel(status: ServerStatus): string {
  switch (status) {
    case 'up':
      return '● up'
    case 'starting':
      return '◌ starting'
    case 'down':
      return '✕ down'
  }
}

function statusLines(): string {
  const cfg = state.config
  const status = state.serverStatus

  const lines = [
    `server   ${serverStatusLabel(status)}`,
    `port     ${PORT}`,
    '',
    cfg ? `rate     ${cfg.rate}` : 'rate     —',
    cfg ? `spike    ${(cfg.spikeProbability * 100).toFixed(1)}%` : 'spike    —',
    cfg ? `malform  ${(cfg.malformedProbability * 100).toFixed(1)}%` : 'malform  —',
    cfg ? `restart  ${cfg.serverRestartIntervalSeconds}s` : 'restart  —',
    '',
    `events   ${state.eventsSeen}`,
    `buffered ${state.logLines.length}/${MAX_LOG_LINES}`,
  ]

  if (state.flash && state.flash.until > Date.now()) {
    lines.push('', state.flash.text)
  } else if (state.lastError) {
    lines.push('', `err: ${state.lastError}`)
  }
  return lines.join('\n')
}

function hotkeyHint(): string {
  const i = currentRateIndex()
  const marker = (idx: number, label: string) => (idx === i ? `▸${label}` : ` ${label}`)
  return [
    marker(0, '1 slow'),
    marker(1, '2 medium'),
    marker(2, '3 fast'),
    marker(3, '4 ludicrous'),
    '  q quit',
  ].join('   ')
}

async function main(): Promise<void> {
  // tui owns the server. if something is already on the port, bail out —
  // running both `npm run dev` and `npm run tui` at once just produces port
  // conflicts and split logs. the identifying header gives a tailored hint
  // when it's our own server that's already up.
  const probe = await probeHealth(800)
  if (probe.kind === 'ours') {
    console.error(
      `[tui] ${SERVER_ID} is already running on :${PORT}.\n` +
        `      run either \`npm run dev\` / \`npm start\` OR \`npm run tui\`, not both.`,
    )
    process.exit(1)
  }
  if (probe.kind === 'foreign') {
    console.error(
      `[tui] port ${PORT} is in use by something that isn't ${SERVER_ID}.\n` +
        `      stop it, or set PORT=<free port> and try again.`,
    )
    process.exit(1)
  }
  appendLine(`[tui] spawning server on :${PORT}`)
  const child = spawnServer()
  pipeChild(child)

  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // we want to kill the child first
    targetFps: 30,
    backgroundColor: palette.bg,
  })

  const root = new BoxRenderable(renderer, {
    id: 'tui-root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: palette.bg,
  })

  const titleBar = new TextRenderable(renderer, {
    id: 'tui-title',
    width: '100%',
    height: 1,
    fg: palette.accent,
    content: ` log-stream-server tui  ·  ${BASE_URL}`,
  })

  const body = new BoxRenderable(renderer, {
    id: 'tui-body',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
    padding: 1,
  })

  const statusBox = new BoxRenderable(renderer, {
    id: 'tui-status',
    width: 28,
    height: '100%',
    flexShrink: 0,
    border: true,
    borderStyle: 'rounded',
    borderColor: palette.border,
    title: ' status ',
    titleAlignment: 'left',
    padding: 1,
    backgroundColor: palette.surface,
  })

  const statusText = new TextRenderable(renderer, {
    id: 'tui-status-text',
    width: '100%',
    fg: palette.text,
    content: statusLines(),
  })
  statusBox.add(statusText)

  const logsBox = new ScrollBoxRenderable(renderer, {
    id: 'tui-logs',
    flexGrow: 1,
    flexShrink: 1,
    height: '100%',
    marginLeft: 1,
    border: true,
    borderStyle: 'rounded',
    borderColor: palette.borderAccent,
    title: ' logs ',
    titleAlignment: 'left',
    stickyScroll: true,
    stickyStart: 'bottom',
    backgroundColor: palette.surface,
    contentOptions: { padding: 1 },
  })

  const logsTextEl = new TextRenderable(renderer, {
    id: 'tui-logs-text',
    width: '100%',
    wrapMode: 'none',
    fg: palette.textDim,
    content: '',
  })
  logsBox.add(logsTextEl)

  const hintBar = new TextRenderable(renderer, {
    id: 'tui-hint',
    width: '100%',
    height: 1,
    fg: palette.textDim,
    content: hotkeyHint(),
  })

  body.add(statusBox)
  body.add(logsBox)
  root.add(titleBar)
  root.add(body)
  root.add(hintBar)
  renderer.root.add(root)

  let quitting = false
  const quit = () => {
    if (quitting) return
    quitting = true
    try {
      child.kill('SIGINT')
    } catch {
      // already dead
    }
    setTimeout(() => {
      renderer.destroy()
      process.exit(0)
    }, 200)
  }

  renderer.keyInput.on('keypress', (key: KeyEvent) => {
    if (key.ctrl && key.name === 'c') return quit()
    if (key.name === 'q') return quit()
    if (key.name === 'r') {
      void refreshStatus()
      flash('refreshed', 600)
      return
    }
    if (key.name === '1') return void patchRate('slow')
    if (key.name === '2') return void patchRate('medium')
    if (key.name === '3') return void patchRate('fast')
    if (key.name === '4') return void patchRate('ludicrous')
    if (key.name === ']' || (key.shift && key.name === 'right')) {
      const next = RATES[(currentRateIndex() + 1) % RATES.length]!
      return void patchRate(next)
    }
    if (key.name === '[' || (key.shift && key.name === 'left')) {
      const next = RATES[(currentRateIndex() + RATES.length - 1) % RATES.length]!
      return void patchRate(next)
    }
  })

  async function refreshStatus(): Promise<void> {
    const [ok, cfg] = await Promise.all([fetchHealth(), fetchConfig()])
    state.serverStatus = ok ? 'up' : 'down'
    if (cfg) state.config = cfg
  }

  // poll loops — independent so a slow /config doesn't delay health
  const healthTimer = setInterval(async () => {
    const ok = await fetchHealth()
    // keep "starting" until first ok; after that toggle up/down freely
    if (state.serverStatus === 'starting' && ok) state.serverStatus = 'up'
    else state.serverStatus = ok ? 'up' : 'down'
  }, HEALTH_POLL_MS)

  const configTimer = setInterval(async () => {
    const cfg = await fetchConfig()
    if (cfg) state.config = cfg
  }, CONFIG_POLL_MS)

  // paint loop — opentui keeps drawing on its own, we just refresh content
  const paintTimer = setInterval(() => {
    statusText.content = statusLines()
    logsTextEl.content = state.logLines.join('\n')
    hintBar.content = hotkeyHint()
  }, 100)

  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
  process.on('exit', () => {
    clearInterval(healthTimer)
    clearInterval(configTimer)
    clearInterval(paintTimer)
  })
}

main().catch((err) => {
  console.error('[tui] fatal', err)
  process.exit(1)
})
