/** Formats a duration for display, e.g. "420 ms" or "3.2 s". */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}
