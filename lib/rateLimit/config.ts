/**
 * lib/rateLimit/config.ts — rate limit configuration.
 *
 * All limits are tunable via environment variables so they can be tightened
 * in production without a code deploy.  Default values are permissive enough
 * for internal HR tooling (employees aren't expected to send dozens of
 * messages per minute) while still blocking automated abuse.
 *
 * Two windows are enforced independently:
 *
 *   Sustained window  — prevents steady long-running abuse
 *     Default: 20 requests per 60 seconds per IP
 *     Env var: RATE_LIMIT_MAX_PER_MINUTE
 *
 *   Burst window      — prevents rapid-fire spam (e.g. pasting the same
 *                       message 10 times in two seconds)
 *     Default: 5 requests per 10 seconds per IP
 *     Env var: RATE_LIMIT_BURST_PER_10S
 *
 * Both limits are checked on every request; the more restrictive one wins.
 *
 * Upgrade path
 * ────────────
 * When moving to a distributed rate limiter (Upstash Redis, Vercel KV):
 *   1. Keep this file unchanged — limits are backend-agnostic.
 *   2. Create a new RateLimiter implementation (e.g. UpstashRateLimiter).
 *   3. Swap the factory call in middleware.ts.
 */

// ── Safe integer parser ────────────────────────────────────────────────────────

/**
 * Parses an env-var string as a positive integer.
 * Falls back to `defaultValue` when the variable is absent, non-numeric,
 * zero, or negative — so misconfigured environments degrade gracefully
 * rather than disabling rate limiting entirely.
 */
function safePositiveInt(raw: string | undefined, defaultValue: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

// ── Window definitions ─────────────────────────────────────────────────────────

export interface WindowConfig {
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Sustained rate limit — the primary long-running abuse gate.
 *
 * 20 req/min is comfortable for a human using the chatbot (a fast typist
 * might send 5–6 questions per minute) while clearly blocking automated
 * scripts.  Lower to 10 or 5 for tighter production controls.
 */
export const SUSTAINED_WINDOW: WindowConfig = {
  maxRequests: safePositiveInt(process.env.RATE_LIMIT_MAX_PER_MINUTE, 20),
  windowMs:    60_000,
};

/**
 * Burst rate limit — catches rapid-fire requests within a short window.
 *
 * A human takes at least 2–3 seconds to read an answer and type a follow-up.
 * 5 requests in 10 seconds is already generous for human interaction.
 * Anything faster than this is almost certainly automated.
 */
export const BURST_WINDOW: WindowConfig = {
  maxRequests: safePositiveInt(process.env.RATE_LIMIT_BURST_PER_10S, 5),
  windowMs:    10_000,
};
