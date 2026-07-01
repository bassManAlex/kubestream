# Changelog

## [0.1.0] — 2026-07-01

First public release.

### Features

- Live event stream via SSE with automatic reconnect and exponential backoff
- Gap fill on reconnect — fetches missed events via REST cursor before resuming the stream
- Filter by event type (Normal / Warning), namespace, and reason; dropdowns populate live from the stream
- Exact-text search across all visible events
- Event detail modal with full YAML rendering and prev/next navigation within the same `involvedObject`
- Rate control — switch emission rate between `slow`, `medium`, `fast`, and `ludicrous` via `PATCH /config`
- IndexedDB persistence — event buffer and cursor survive a page refresh
- Malformed event handling — invalid payloads counted and shown as placeholder rows; no crash
- Virtualized list via `react-window` — handles thousands of events without frame drops
- Connection badge — live indicator for Connected / Reconnecting / Disconnected states

### Connecting to your own backend

Set `VITE_SERVER_URL` at build time to point the frontend at any compatible server:

```sh
VITE_SERVER_URL=https://your-server.example.com npm run build
```

The frontend expects:
- `GET /events/stream` — SSE stream, one JSON event per `data:` line
- `GET /events?since=<cursor>&limit=<n>` — REST catch-up endpoint returning `{ events, nextCursor }`
- `PATCH /config` — optional; required only if you want the rate/config toolbar to work
- `GET /health` — optional; used by the E2E test suite

See the included backend in the repo root for a reference implementation.
