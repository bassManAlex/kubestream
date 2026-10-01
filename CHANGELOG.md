# Changelog

## 0.1.0 (2026-10-01)

First public release.

- Live SSE stream with automatic reconnect and exponential backoff
- Missed events are fetched from the REST cursor after a reconnect or a pause
- Filters by type, namespace and reason, plus a case sensitive text search
- Event detail as YAML, with prev/next through the events of the same object
- Server rate switch: `slow`, `medium`, `fast`, `ludicrous`
- Buffer and cursor kept in IndexedDB across refreshes
- Malformed events counted and shown as placeholder rows
- Events lost beyond the server buffer are reported in the header
- Virtualized list of the newest 2000 events that stays still while you read
- Connection badge: Connecting, Connected, Reconnecting, Disconnected

The API a backend has to implement is described in the [README](README.md#api).
