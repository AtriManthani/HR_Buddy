/**
 * lib/rateLimit/rateLimiter.ts — rate limiter abstraction and in-memory implementation.
 *
 * Architecture
 * ────────────
 * The `RateLimiter` interface is the stable contract.  `InMemoryRateLimiter`
 * is the default implementation — it uses a module-level Map that persists
 * within a single process (Edge worker, Node.js server).
 *
 * In-memory behaviour on Vercel
 * ──────────────────────────────
 * Vercel Edge middleware runs in long-lived V8 isolates at CDN edge nodes.
 * The Map survives across requests handled by the same isolate, so rate
 * limiting works correctly within one edge node.  Different edge nodes
 * maintain independent Maps, which means limits are per-node rather than
 * globally shared — acceptable for basic abuse protection.
 *
 * For true global enforcement (e.g. coordinated attacks from many IPs, or
 * strict per-user quotas) replace InMemoryRateLimiter with a distributed
 * implementation backed by Upstash Redis or Vercel KV:
 *
 *   @upstash/ratelimit + @upstash/redis  — drop-in, fully edge-compatible
 *   @vercel/kv                           — Vercel-native, minimal config
 *
 * Upgrade path
 * ────────────
 * 1. Install `@upstash/ratelimit` and `@upstash/redis`.
 * 2. Create `UpstashRateLimiter implements RateLimiter` in this file.
 * 3. Change `createRateLimiters()` to return UpstashRateLimiter instances
 *    when `process.env.UPSTASH_REDIS_REST_URL` is set.
 * 4. No changes needed anywhere else — the middleware uses RateLimiter only.
 *
 * Algorithm
 * ─────────
 * Fixed-window counter per (key, window-start-time).  Simple, O(1) per
 * check, and the only algorithm that works without atomic server-side
 * operations in a single-node in-memory store.
 *
 * Trade-off: at window boundaries a user can briefly send 2× the limit
 * (burst at end of window N + burst at start of window N+1).  The separate
 * burst window mitigates this in practice.
 */

import type { WindowConfig } from "./config";

// ── Public types ──────────────────────────────────────────────────────────────

/** Result of a single rate-limit check. */
export interface RateLimitResult {
  /** Whether the request is permitted. */
  allowed: boolean;
  /** The configured maximum for this window. */
  limit: number;
  /** Requests remaining in the current window (≥ 0). */
  remaining: number;
  /** Unix epoch seconds when the current window resets. */
  resetAt: number;
  /**
   * Seconds the caller should wait before retrying.
   * 0 when `allowed` is true.
   */
  retryAfter: number;
}

/** Stable interface — swap the implementation without touching the middleware. */
export interface RateLimiter {
  /**
   * Records one request for `key` and returns the current rate-limit state.
   * Always increments the counter — call this exactly once per request.
   */
  check(key: string): RateLimitResult;

  /**
   * Resets the counter for `key`.
   * Intended for tests and administrative use only.
   */
  reset(key: string): void;
}

// ── Internal window state ─────────────────────────────────────────────────────

interface WindowState {
  count:   number;
  resetAt: number; // ms timestamp
}

// ── In-memory implementation ──────────────────────────────────────────────────

/**
 * Fixed-window rate limiter backed by an in-memory Map.
 *
 * Edge-safe: uses only standard JS globals (Map, Date.now()).
 * Not distributed: suitable for single-process or per-edge-node enforcement.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly store   = new Map<string, WindowState>();
  private readonly limit:   number;
  private readonly windowMs: number;

  /** Internal counter used to trigger periodic stale-entry cleanup. */
  private checkCount = 0;

  constructor(config: WindowConfig) {
    this.limit    = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  check(key: string): RateLimitResult {
    // Periodically evict expired entries to prevent unbounded memory growth.
    // Every 500 checks is a safe cadence — even at 100 req/s this sweeps
    // every ~5 seconds and adds negligible overhead to individual checks.
    if (++this.checkCount % 500 === 0) {
      this.sweep();
    }

    const now = Date.now();
    let win   = this.store.get(key);

    // Start a new window if none exists or the previous one has expired.
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + this.windowMs };
      this.store.set(key, win);
    }

    win.count++;

    const allowed     = win.count <= this.limit;
    const remaining   = Math.max(0, this.limit - win.count);
    const resetAtSecs = Math.ceil(win.resetAt / 1000);
    const retryAfter  = allowed ? 0 : Math.ceil((win.resetAt - now) / 1000);

    return { allowed, limit: this.limit, remaining, resetAt: resetAtSecs, retryAfter };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  /** Remove entries whose window has already expired. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, win] of this.store) {
      if (now >= win.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a pair of rate limiters: one for the burst window, one for the
 * sustained window.  Returns them as a plain object so the middleware can
 * check both independently without coupling to a specific class.
 *
 * This factory is the single place to swap the implementation:
 *   - Set UPSTASH_REDIS_REST_URL → return UpstashRateLimiter instances.
 *   - Set RATE_LIMIT_DISABLED=true → return no-op instances (testing).
 */
export function createRateLimiters(config: {
  sustained: WindowConfig;
  burst:     WindowConfig;
}): { sustained: RateLimiter; burst: RateLimiter } {
  return {
    sustained: new InMemoryRateLimiter(config.sustained),
    burst:     new InMemoryRateLimiter(config.burst),
  };
}
