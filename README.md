# frontend assessment

**Build a log viewer for a Kubernetes-style event stream.**

This repo gives you a small server that pretends to be a Kubernetes events feed. It generates fake events and exposes them three ways: a REST endpoint, a SSE stream, and WebSocket.

You don't need to (and shouldn't) modify this server — just run it and read from it.

Your deliverable is a frontend to display the stream and show individual events. The server is intentionally a bit hostile (see "Deliberate Problems" below), and dealing with that is part of the assessment.

## Assessment Requirements

These are the minimum requirements for the assessment.

- **Live log stream.** Show events as they arrive, in a readable list, use one or more of the transports available from the server.
- **Click an event → detail modal.** The modal shows the full event rendered as **YAML**.
- **Prev / next within the modal.** From the detail modal, navigate to the **previous and next events for the same entity** — i.e. events whose `involvedObject.uid` matches the one you opened.
- **Exact-text filter.** Add an input that filters the visible event list to events containing the exact text entered by the user.
- **Rate selector.** A control somewhere in the UI that lets the user switch the server's emission rate between `slow`, `medium`, `fast`, and `ludicrous`. It works by sending a PATCH request to `/config`, the server reacts immediately.
- **Stay responsive under load.** The app should remain usable in `fast` mode while events are arriving, filtering, scrolling, and opening details.
- **Survive the chaos.** The server may drop connections and emit malformed events. The UI should keep working when this happens, it should not crash or require a full page reload.

### Optional Improvements

The requirements above are the core assessment. You don't need to build anything beyond them, but additional features are welcome if they make the log viewer easier, faster, or more pleasant to use. If you add them, be ready to explain the user problem each feature solves and the trade-offs you made.

## Usage

### Running the server

```sh
npm install
npm run start
```

Server listens on `http://localhost:4000`. Override with `PORT`.

There's an optional TUI (`npm run tui`) that renders the stream in your terminal and allow changing the settings at runtime. It requires [Bun](https://bun.sh) to run and is **not required** for the assessment, `npm run start` is enough.

### Read Events

There are three ways to read events.

#### REST

Endpoints:

```txt
GET /events?limit=20
GET /events?since=evt_xxx&limit=100
```

Examples:

```sh
curl 'http://localhost:4000/events?limit=20'
curl 'http://localhost:4000/events?since=evt_xxx&limit=100'
```

Response:

```ts
type EventsResponse = {
  events: string[] // each string is one event
  nextCursor: string | null // pass this as ?since=... to catch up later
}
```

If there are no newer events for a `?since=evt_xxx` request, `events` is empty and `nextCursor` is the same cursor you sent. Keep polling with that cursor until new events arrive.

#### SSE

Endpoint:

```txt
GET /events/stream
```

Example:

```sh
curl -N http://localhost:4000/events/stream
```

Response:

```txt
data: <json-string>
```

SSE also emits a heartbeat every 15s.

#### WebSocket

Endpoint:

```txt
GET /events/ws
```

Example:

```sh
wscat -c ws://localhost:4000/events/ws
```

Response:

```txt
<json-string>
```

The transport envelope is always well-formed, but an individual event string may be not valid JSON.


### Server config

Live config is read from `config.json`, read the current config with:

```sh
curl http://localhost:4000/config
```

Config response shape:

```ts
type Config = {
  rate: 'slow' | 'medium' | 'fast' | 'ludicrous' // emit rate, from ~1/s to ~60/s
  spikeProbability: number                       // per-second burst chance, 0-1
  malformedProbability: number                   // chance any event is corrupted, 0-1
  serverRestartIntervalSeconds: number           // mean seconds between restarts 0 disables
}
```

Update config at runtime with `PATCH /config`. Changes apply immediately and persist to `config.json`:


## Deliberate Problems

Two things go wrong on purpose to simulate real-world scenarios. Your UI should keep working when they happen.

**1. The server restarts.** Every several minutes the HTTP listener stops, stays down for a few seconds, then comes back. The event ring buffer survives the restart (event ids keep climbing), so a reconnect with `?since=<last id>` against the REST endpoint will fill in the gap.

**2. Some events are malformed.** Events may arrive as broken JSON strings, truncated, missing quotes, `NaN` where a number should be, etc. The envelope is always valid, only the inner log string may be  corrupted.

## Other Notes

**Can I use React / Vue / Svelte / vanilla / HTMX / something else?**
Yes, anything. Pick what you'd defend in a code review.

**Which of the three endpoints should I use?**
Any of the three transports is acceptable. Be ready to explain why the one you chose fits your implementation.

**Do I need to handle every malformed event / every disconnect perfectly?**
Your UI should not fall over when they happen. How gracefully you handle them, how visible the recovery is, these are trade-offs you have to decide.

**How much should I build?**
The scope is broad on purpose. Build a small surface well, and be ready to talk about what you'd add with more time. We care about the trade-offs you make, not the line count.

**Should I make it pretty?**
Yes, within reason. Basic but good-looking beats fancy-but-broken.
