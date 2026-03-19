/**
 * lib/rateLimit/ipExtract.ts — client IP extraction for Vercel deployments.
 *
 * Header priority
 * ───────────────
 * Vercel's infrastructure always sets `x-forwarded-for` with the true client
 * IP as the first entry (before any intermediate proxies it adds).  On
 * self-hosted deployments behind nginx, `x-real-ip` is the common alternative.
 *
 * Security note
 * ─────────────
 * On Vercel, `x-forwarded-for` is set by Vercel's own CDN and cannot be
 * spoofed by the client — the CDN overwrites any client-supplied value.
 * On self-hosted deployments, if the server is not correctly configured to
 * strip or trust proxy headers, this value CAN be spoofed.  For self-hosted
 * production use, configure your reverse proxy to set a trusted header.
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
  // Vercel CDN sets this; value is "clientIp, proxy1, proxy2"
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
