# K8s Event Stream — Frontend Assessment

A log viewer for a Kubernetes-style event stream, built as part of the Clastix frontend assessment.

## Stack

- **Vite** + **React 19** (with React Compiler) + **TypeScript**
- **TailwindCSS v4** for styling
- **react-window** + **react-virtualized-auto-sizer** for list virtualization
- **js-yaml** for YAML rendering in the event detail modal

## Running the project

From the repo root, install all dependencies (server + frontend workspace):

```bash
npm install
pnpm install
```

Start the event server (terminal 1):

```bash
npm run start
```

Start the frontend (terminal 2):

```bash
cd app
pnpm dev
```

The frontend runs on `http://localhost:5173`. The Vite dev server proxies `/events` and `/config` to `http://localhost:4000`.

## Architecture decisions

### Transport: SSE

I chose SSE as the primary transport over WebSocket and REST polling for three reasons:

- SSE is unidirectional by nature — the server pushes events, the client never sends data on the stream channel. WebSocket's bidirectional channel would be unused overhead.
- The browser's `EventSource` API reconnects automatically on connection loss, which simplifies the reconnect logic significantly.
- SSE is HTTP-native, which means it works transparently through proxies and load balancers without additional configuration.

REST polling is used as a catch-up mechanism only: when SSE reconnects after a server restart, the client fetches missed events using `GET /events?since=<last_cursor>` before resuming the stream.

### Handling malformed events

The server deliberately emits broken JSON. Rather than silently dropping malformed events or letting a parse error crash the app, I represent them explicitly in the type system:

```typescript
type ParsedEvent =
  | { status: 'ok'; data: KubeEvent; raw: string }
  | { status: 'malformed'; raw: string; id: string }
```

This means the UI can render a visible "malformed event" row instead of a silent gap in the stream. The app never crashes on bad input — every event string goes through a `try/catch` parse and comes out as one of the two cases above.

### State management: useReducer

I used `useReducer` instead of Zustand or any external state library. The app has a single, well-defined state shape with typed actions — this is exactly the complexity level where a reducer is the right tool. Adding a library would introduce overhead without solving a real problem.

One deliberate decision in the reducer: when the stream is paused, `EVENTS_RECEIVED` is a no-op. This means pausing is handled entirely in state logic, not in the transport layer. The SSE connection stays open — we discard incoming events at the reducer level rather than closing and reopening the connection.

### Event cap

The event list is capped at 2000 entries. In `ludicrous` mode the server emits ~60 events/second — without a cap, memory usage grows unbounded. When the cap is reached, the oldest events are dropped. The UI shows "2000+ events (capped)" in the header to make this explicit.

### Virtualization

The event list is virtualized with `react-window`. Without virtualization, rendering 2000 DOM nodes while new events arrive at 60/s causes noticeable jank. With `FixedSizeList`, only the visible rows are in the DOM at any time regardless of total event count.

### React Compiler

I used the React 19 compiler variant from the Vite template. The compiler eliminates the need for manual `useMemo`/`useCallback` in most cases, which is relevant for a high-frequency update scenario like this one. One known issue: in development mode, the compiler's render profiler hits a `DataCloneError` under sustained `ludicrous` load. This is a dev-only behaviour — the profiling instrumentation is stripped in production builds.

## Features

- **Live event stream** via SSE with automatic reconnection
- **Catch-up on reconnect** via REST polling with cursor-based pagination
- **Event detail modal** with full event rendered as YAML
- **Prev / next navigation** within the modal for events sharing the same `involvedObject.uid`, with keyboard support (← →, Esc)
- **Exact-text filter** across name, namespace, reason, message, and type
- **Type filter** — All / Normal / Warning
- **Rate selector** — slow / medium / fast / ludicrous, via PATCH `/config`
- **Pause / resume** — suspends event ingestion while keeping the SSE connection open
- **Auto-scroll with scroll lock** — follows new events automatically, locks when scrolling up, resumes via button
- **Malformed event handling** — broken JSON is displayed as a labelled row, never crashes the app
- **Copy YAML** — copies the full event YAML to clipboard from the detail modal
- **Event cap indicator** — header shows total count and flags when the 2000-event cap is active
- **Malformed counter** — header tracks total malformed events received since page load

## What I would add with more time

- **Full list virtualization with dynamic row heights** — current implementation assumes fixed 36px rows; variable-height rows would allow showing more of the message inline
- **Exponential backoff on reconnect** — current reconnect delay is fixed at 3 seconds
- **Namespace / reason filter facets** — extracted from the live event stream, not hardcoded
- **IndexedDB persistence** — survive a page refresh without losing the event history
- **E2E tests** with Playwright covering the chaos scenarios (malformed events, server restart)