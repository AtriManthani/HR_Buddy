/**
 * lib/rateLimit/ipExtract.ts — client IP extraction from request headers.
 *
 * Header priority
 * ───────────────
 * When behind a reverse proxy (nginx, Caddy, etc.), `x-forwarded-for` carries
 * the true client IP as the first entry.  `x-real-ip` is the common nginx
 * alternative header.
 *
 * Security note
 * ─────────────
 * If your reverse proxy is correctly configured it will overwrite any
 * client-supplied forwarded-for value before the request reaches the app.
 * For production use, configure your reverse proxy to set a trusted header
 * and strip any client-supplied values.
 *
 * The function accepts a minimal header interface so it is usable from both
 * the Edge middleware (`NextRequest`) and Node.js route handlers (`Request`).
 */

/** Minimal header-reading interface compatible with both Edge and Node runtimes. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Extracts the client's IP address from incoming request headers.
 *
 * @param headers - The request headers object (NextRequest.headers or Headers).
 * @returns         The client IP string, or "127.0.0.1" when no header is found
 *                  (local development without a reverse proxy).
 */
export function extractIp(headers: HeaderReader): string {
  // Reverse proxy sets this; value is "clientIp, proxy1, proxy2"
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }

  // Common nginx / self-hosted proxy header
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  // Local development fallback
  return "127.0.0.1";
}
