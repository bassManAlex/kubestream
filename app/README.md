# KubeStream frontend

React 19 (with React Compiler), TypeScript strict, Vite 8, Tailwind CSS 4, Zod 4, `react-window`.

Setup, architecture and the API are in the [main README](../README.md).

## Scripts

| Command                             | What it does                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                          | Dev server on port 5173, proxying `/events` and `/config` to `localhost:4000` |
| `pnpm build`                        | Type check and production build                                               |
| `pnpm lint`                         | ESLint, including `no-floating-promises` and the React Hooks rules            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                      |
| `pnpm test`                         | Unit tests (Vitest)                                                           |
| `pnpm test:coverage`                | Unit tests with coverage                                                      |
| `pnpm test:e2e`                     | Playwright suite; starts its own backends and frontends                       |

## Layout

| Path                          | Contents                                                                   |
| ----------------------------- | -------------------------------------------------------------------------- |
| `src/services/eventStream.ts` | `EventStreamClient`: SSE connection, reconnect, catch-up, batching, cursor |
| `src/services/eventStore.ts`  | IndexedDB snapshot load and save                                           |
| `src/store/eventsReducer.ts`  | Application state and actions                                              |
| `src/hooks/`                  | React adapters: stream, persistence, keyboard                              |
| `src/components/`             | UI                                                                         |
| `src/types.ts`                | Zod schemas and the types derived from them                                |
| `e2e/`                        | Playwright specs and the `run.mjs` wrapper                                 |
