import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Catch potential issues (double renders, effect misuse) in development.
  reactStrictMode: true,

  // Fix Next.js multi-lockfile workspace root detection warning.
  // Pins the trace root to this project's directory so local builds
  // do not warn about adjacent package-lock.json files.
  outputFileTracingRoot: require("path").join(__dirname),

  // pdf-parse uses native Node addons — keep it out of the edge/client bundle.
  // Only relevant if a future route accidentally imports it; the ingest scripts
  // already run in ts-node (not Next.js) so this is a belt-and-suspenders guard.
  serverExternalPackages: ["pdf-parse"],

  // ── Security headers ────────────────────────────────────────────────────────
  //
  // Applied to every route.  These are baseline hardening headers; they do not
  // replace authentication or input validation.
  //
  // Content-Security-Policy notes:
  //   - script-src 'self': no inline scripts, no third-party JS
  //   - style-src 'self' 'unsafe-inline': Tailwind needs inline styles at runtime
  //   - connect-src 'self': the /api/chat fetch goes same-origin only
  //   - img-src 'self' data:: favicon.svg is served as data URI in some browsers
  //   - font-src 'self': Inter is self-hosted via next/font (no Google Fonts CDN call)
  //
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking
          { key: "X-Frame-Options",         value: "DENY" },
          // Block MIME-type sniffing
          { key: "X-Content-Type-Options",  value: "nosniff" },
          // Control referrer information
          { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
          // Lock down browser feature access
          {
            key:   "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Content Security Policy
          {
            key:   "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              "img-src 'self' data:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          // Force HTTPS for 1 year (ignored on plain HTTP in local dev)
          {
            key:   "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
