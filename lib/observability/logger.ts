/**
 * lib/observability/logger.ts — structured, production-safe request logger.
 *
 * Design principles
 * ─────────────────
 * 1. NEVER log user message content, session secrets, or API keys.
 *    Only metadata is captured: lengths, counts, scores, latency, event names.
 * 2. Structured JSON output in production — Datadog, Axiom, Logtail,
 *    and similar tools can parse newline-delimited JSON directly.
 * 3. Human-readable dev output — plain `[level] event key=value …` lines
 *    when NODE_ENV !== "production", for local development readability.
 * 4. All fields are plain scalars (string | number | boolean | null) so the
 *    output is safe to pass to any downstream log aggregator without escaping.
 *
 * Observability integration
 * ─────────────────────────
 * // ANALYTICS HOOK: replace console.* calls below with your preferred log sink.
 * // All structured fields are plain scalars — safe to forward to Datadog,
 * // Axiom, Logtail, or any NDJSON-compatible log aggregator.
 *
 * Usage
 * ─────
 * import { log } from "@/lib/observability/logger";
 *
 * log("info",  "chat.rag.retrieved", { chunkCount: 5, topScore: 0.91, latencyMs: 220 });
 * log("warn",  "chat.output.guard",  { flagged: true, reasonCount: 1 });
 * log("error", "chat.llm.error",     { errorType: "rate_limit" });
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Safe scalar fields only — no strings that could contain user content. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

// ── Core logger ───────────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Emits a structured log entry.
 *
 * In production: JSON line on stdout (forwarded to any log aggregator).
 * In development: formatted `[LEVEL] event field=value …` line for readability.
 *
 * @param level  - Severity level.
 * @param event  - Dot-namespaced event name (e.g. "chat.rag.retrieved").
 * @param fields - Safe metadata fields — never include user content or secrets.
 */
export function log(level: LogLevel, event: string, fields?: LogFields): void {
  if (IS_PROD) {
    // Structured JSON — one object per line, compatible with Datadog,
    // Axiom, Logtail, and any NDJSON-compatible log aggregator.
    const entry: Record<string, unknown> = {
      level,
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    };
    const emit = level === "error" ? console.error
               : level === "warn"  ? console.warn
               : console.log;
    emit(JSON.stringify(entry));
  } else {
    // Human-readable dev output.
    const fieldStr = fields
      ? " " + Object.entries(fields)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ")
      : "";

    const emit = level === "error" ? console.error
               : level === "warn"  ? console.warn
               : level === "debug" ? console.debug
               : console.log;

    emit(`[${level.toUpperCase()}] ${event}${fieldStr}`);
  }
}
