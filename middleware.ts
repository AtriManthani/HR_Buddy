/**
 * middleware.ts — Next.js Edge Middleware for rate limiting.
 *
 * Runs at the Vercel CDN edge before any serverless function is invoked,
 * making it the cheapest and most effective place to block abuse — rejected
 * requests never reach the Node.js runtime or the OpenAI API.
 *
 * What it does
 * ────────────
 * 1. Extracts the client IP from Vercel's `x-forwarded-for` header.
 * 2. Checks the burst window  (5 req / 10 s per IP by default).
 * 3. Checks the sustained window (20 req / 60 s per IP by default).
 * 4. If either limit is exceeded → returns 429 Too Many Requests with
 *    a Retry-After header and a safe, user-friendly JSON body.
 * 5. If both limits pass → forwards the request with X-RateLimit-* headers
 *    so clients and monitoring tools can track consumption.
 *
 * Rate limit headers on every passing response:
 *   X-RateLimit-Limit     — sustained window maximum
 *   X-RateLimit-Remaining — requests remaining in the sustained window
 *   X-RateLimit-Reset     — unix timestamp (seconds) when the window resets
 *
 * Additional header on 429:
 *   Retry-After           — seconds until the client may retry
 *
 * Scope
 * ─────
 * Only `/api/chat` is rate-limited (see `config.matcher` below).
 * Static assets, page routes, and other API routes are unaffected.
 *
 * In-memory vs distributed
 * ─────────────────────────
 * Limits are enforced per-edge-node (each Vercel edge location has its own
 * counter Map).  For most internal HR tooling deployments this is sufficient
 * — a single bad actor hitting one edge node is blocked there.
 *
 * For strict global enforcement across all edge nodes, swap the limiter
 * implementation in createRateLimiters() to use Upstash Redis or Vercel KV.
 * The middleware code here does not need to change.
 *
 * Disabling for testing
 * ─────────────────────
 * Set RATE_LIMIT_DISABLED=true in .env.local to skip all checks (useful for
 * automated end-to-end tests that send many requests quickly).
 */

import { NextRequest, NextResponse } from "next/server";
import { SUSTAINED_WINDOW, BURST_WINDOW } from "@/lib/rateLimit/config";
import { createRateLimiters }             from "@/lib/rateLimit/rateLimiter";
import { extractIp }                      from "@/lib/rateLimit/ipExtract";

// ── Singleton rate limiter instances ─────────────────────────────────────────
//
// Module-level singletons persist for the lifetime of the Edge worker process.
// On Vercel, each edge node maintains its own pair of limiters.
//
// These are created once at module load — safe because InMemoryRateLimiter
// uses only standard JS globals (no Node.js APIs, fully Edge-compatible).

const limiters = createRateLimiters({
  sustained: SUSTAINED_WINDOW,
  burst:     BURST_WINDOW,
});

// ── User-facing error message ─────────────────────────────────────────────────
//
// Deliberately generic — does not reveal which window was exceeded or the
// exact limit, to make automated probing harder.

const RATE_LIMITED_MESSAGE =
  "Too many requests. Please wait a moment before trying again.";

// ── Middleware handler ────────────────────────────────────────────────────────

export function middleware(req: NextRequest): NextResponse {
  // Allow disabling rate limiting for automated tests.
  if (process.env.RATE_LIMIT_DISABLED === "true") {
    return NextResponse.next();
  }

  const ip = extractIp(req.headers);

  // ── Burst check ────────────────────────────────────────────────────────────
  // Checked first — a burst violation has a shorter Retry-After than the
  // sustained window, so returning it gives the client the most accurate
  // "try again in N seconds" value for rapid-fire spam.

  const burst = limiters.burst.check(`burst:${ip}`);
  if (!burst.allowed) {
    return rateLimitedResponse(burst.retryAfter, burst.limit, 0, burst.resetAt);
  }

  // ── Sustained check ────────────────────────────────────────────────────────

  const sustained = limiters.sustained.check(`sustained:${ip}`);
  if (!sustained.allowed) {
    return rateLimitedResponse(
      sustained.retryAfter,
      sustained.limit,
      0,
      sustained.resetAt,
    );
  }

  // ── Pass through ───────────────────────────────────────────────────────────
  // Attach the sustained window's consumption to the response so the client
  // can display "X requests remaining" or trigger a warning UI.

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit",     String(sustained.limit));
  response.headers.set("X-RateLimit-Remaining", String(sustained.remaining));
  response.headers.set("X-RateLimit-Reset",     String(sustained.resetAt));
  return response;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rateLimitedResponse(
  retryAfter: number,
  limit:      number,
  remaining:  number,
  resetAt:    number,
): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: RATE_LIMITED_MESSAGE }),
    {
      status: 429,
      headers: {
        "Content-Type":        "application/json",
        "Retry-After":         String(retryAfter),
        "X-RateLimit-Limit":   String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset":   String(resetAt),
        // Prevent the 429 from being cached by any CDN layer
        "Cache-Control":       "no-store",
      },
    },
  );
}

// ── Matcher ───────────────────────────────────────────────────────────────────

/**
 * Only run this middleware on the chat API endpoint.
 *
 * Excluding static files, page routes, and other API routes avoids
 * unnecessary overhead and prevents false positives on assets that
 * are fetched in rapid succession by the browser on page load.
 */
export const config = {
  matcher: "/api/chat",
};
