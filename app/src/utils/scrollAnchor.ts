// Rows inserted above the old first row. 0 if that row is gone (filter
// change, or trimmed).
export function rowsPrepended<T>(
  prev: readonly T[],
  next: readonly T[],
): number {
  const head = prev[0];
  if (head === undefined || prev === next) return 0;
  return Math.max(0, next.indexOf(head));
}
