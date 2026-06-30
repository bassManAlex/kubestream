# KubeStream

A resilient, production-quality log viewer for a Kubernetes-style event stream.

Built as part of the Clastix frontend assessment, then hardened across three review milestones covering correctness, performance, type safety, accessibility, and architecture.

## Stack

- **Vite 8** + **React 19** (React Compiler) + **TypeScript** (strict + noUncheckedIndexedAccess)
- **TailwindCSS v4** for styling
- **react-window v2** + **react-virtualized-auto-sizer** for list virtualization
- **js-yaml** for YAML rendering in the event detail modal
- **zod v4** for runtime schema validation at the network boundary

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

## Quality gates

```bash
cd app
pnpm exec tsc -b   # strict TypeScript — zero errors
pnpm lint          # ESLint with no-floating-promises + no-misused-promises
pnpm test          # 29 unit tests — all pass
pnpm build         # production bundle
```

## Architecture

### Transport layer

SSE is the primary transport. `EventSource` is unidirectional by design — WebSocket's bidirectional channel would be unused overhead — and browser-native reconnect simplifies lifecycle management.

REST catch-up (`GET /events?since=<cursor>&limit=100`) fills the gap after a server restart. The client drains **all pages** in a cursor loop before resuming live ingestion, so no events are lost regardless of how long the outage lasts.

The transport is fully encapsulated in `app/src/services/eventStream.ts` (`EventStreamClient`), a framework-agnostic class owning the `EventSource`, cursor, rAF-batched dispatch, and exponential backoff. `useEventStream` is a 30-line adapter that wires the class to the reducer.

### Resilience

| Scenario | Behaviour |
| --- | --- |
| Server restart | Catch-up loop drains the full gap cursor-by-cursor; order guaranteed |
| Live events during catch-up | Buffered and flushed after the gap is filled |
| Reconnect failures | Exponential backoff: 1s -> 2s -> 4s, capped at 30s |
| No connection after 4 attempts | Status transitions to `Disconnected` |
| Malformed JSON from server | Parsed as `{ status: 'malformed' }` — displayed as a labelled row, never crashes |

### Performance

SSE events are coalesced via `requestAnimationFrame`: up to 60 raw events per second collapse into a single reducer dispatch and render per frame. The store is newest-first, so the list never reverses the array on render.

### Type safety

The full TypeScript `strict` suite is enabled in `tsconfig.app.json` (`strict`, `noUncheckedIndexedAccess`). All discriminated unions are exhaustive. Network payloads are validated with zod schemas (`KubeEventSchema`, `EventsResponseSchema`) — `JSON.parse(…) as T` casts do not exist in this codebase.

### State management

One `useReducer` holds the full application state: events, cursor, connection status, text filter, type filter, selected event, and pause state. The reducer is a pure function with a typed action union — no external state library, no hidden side effects.

### Accessibility

- Event list rows are `<button>` elements; fully keyboard-navigable.
- The detail modal carries `role="dialog"`, `aria-modal`, and `aria-label`; focus moves in on open, is trapped within by Tab/Shift-Tab, and restores to the triggering row on close.
- Filter input has an `aria-label`.

## Features

- **Live event stream** via SSE with automatic reconnection and exponential backoff
- **Catch-up on reconnect** — cursor loop drains the full gap, not just the first page
- **rAF batching** — up to 60 events/s coalesced to one dispatch per frame
- **Event detail modal** — full YAML rendering, copy to clipboard, prev/next sibling navigation (← →, Esc)
- **Exact-text filter** across name, namespace, reason, message, and type (debounced 150ms)
- **Type filter** — All / Normal / Warning (in reducer state)
- **Rate selector** — slow / medium / fast / ludicrous via PATCH `/config`, with optimistic UI and revert on failure
- **Pause / resume** — suspends ingestion; cursor frozen so missed events are recoverable on resume
- **Auto-scroll with scroll lock** — follows new events, locks on manual scroll, resumes via button
- **Malformed event handling** — broken or schema-invalid JSON shown as a labelled row, never crashes
- **Copy YAML** — copies the full event YAML to clipboard (async, with error handling)
- **Event cap** — 2000-event ring buffer; oldest events dropped; header shows cap status
- **Malformed counter** — total malformed events since page load shown in header
- **Empty states** — distinct messages for "waiting for first event", "no events match filter", "reconnecting"
- **Error boundary** — wraps list and modal; recoverable fallback; SSE connection survives a render crash
- **Disconnected state** — badge turns red after 4 consecutive failed reconnect attempts

## What remains (post-roadmap)

- **IndexedDB persistence** — survive a page refresh without losing event history
- **Namespace / reason filter facets** — derived from the live stream, not hardcoded
- **Variable-height virtualization** — current rows are fixed at 36px; `VariableSizeList` would allow inline message preview
- **E2E Playwright suite** — covering server restart, ludicrous rate, malformed injection
