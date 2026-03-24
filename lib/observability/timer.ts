/**
 * lib/observability/timer.ts — high-resolution latency measurement.
 *
 * Uses `Date.now()` (millisecond precision) so it works in both the Node.js
 * runtime and edge runtimes without any polyfills.
 *
 * Usage
 * ─────
 * const elapsed = startTimer();
 * // … do work …
 * const ms = elapsed(); // milliseconds since startTimer() was called
 * log("info", "chat.rag.retrieved", { latencyMs: ms });
 */

/**
 * Starts a timer and returns a function that returns elapsed milliseconds.
 *
 * @returns A zero-argument function that, when called, returns the number of
 *          milliseconds elapsed since `startTimer()` was called.
 */
export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
