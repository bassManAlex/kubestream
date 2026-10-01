// Abortable waits for the listener lifecycle.

// setTimeout fires after 1 ms for anything longer, so long waits are split.
const LONGEST_TIMER_MS = 2_147_483_647;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

// Resolves after `ms` (Infinity waits for the signal only), or as soon as
// the signal aborts.
export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  let remaining = ms;
  while (remaining > 0 && !signal.aborted) {
    const step = Math.min(remaining, LONGEST_TIMER_MS);
    await wait(step, signal);
    remaining -= step;
  }
}
