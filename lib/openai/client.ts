/**
 * lib/openai/client.ts — OpenAI client singleton and server-side utilities.
 *
 * Architecture guarantees:
 *   - The client is instantiated once at module load (singleton).
 *   - Credentials come exclusively from lib/config/env.ts, which enforces
 *     server-side-only access and throws immediately if imported in a browser.
 *   - This module MUST NOT be imported from any 'use client' component.
 *     Violations are caught at runtime by env.ts's client-side guard.
 *
 * ── Cost reference (prices as of early 2025) ────────────────────────────────
 *
 *   gpt-4o-mini
 *     Input:  $0.15 / 1M tokens  ≈ $0.000150 per 1K input tokens
 *     Output: $0.60 / 1M tokens  ≈ $0.000600 per 1K output tokens
 *     Typical RAG turn: ~2 000 input + ~400 output ≈ $0.00054 per request
 *     At 1 000 requests/day: ~$0.54/day
 *
 *   text-embedding-3-small
 *     $0.02 / 1M tokens  ≈ $0.000020 per 1K tokens
 *     ~400 tokens per chunk; 200 chunks ≈ $0.0016 per full ingest
 *
 *   Context window: 128 000 tokens (gpt-4o-mini)
 *   Max output:       16 384 tokens (gpt-4o-mini)
 *
 * ── Default SDK behaviour ────────────────────────────────────────────────────
 *
 *   The openai SDK automatically retries:
 *     - 429 Rate Limit (default 2 retries with exponential back-off)
 *     - 500 / 503 Server errors (default 2 retries)
 *   Timeout: 10 minutes by default (generous for streaming; fine here).
 *   Both can be overridden per-call: `{ maxRetries: 0, timeout: 30_000 }`.
 */

import OpenAI from "openai";
import { env } from "@/lib/config/env";

// ── Client singleton ──────────────────────────────────────────────────────────

/**
 * Single shared OpenAI client for all server-side API calls.
 *
 * Created once at module load.  env.ts guarantees OPENAI_API_KEY is present
 * and non-empty before this line executes — missing keys throw at startup,
 * not silently at the first request.
 */
export const openaiClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  // maxRetries / timeout left at SDK defaults (2 retries, 10 min).
  // Override at call-site if individual routes need different behaviour.
});

// ── Model constants ───────────────────────────────────────────────────────────

/**
 * Chat completion model.
 * Default: "gpt-4o-mini"  — Override with OPENAI_MODEL env var.
 * Swap to "gpt-4o" for higher accuracy at ~15× cost.
 */
export const CHAT_MODEL = env.OPENAI_MODEL;

/**
 * Embedding model.
 * Default: "text-embedding-3-small" — 1 536 dimensions, best cost/quality.
 * Override with OPENAI_EMBEDDING_MODEL env var.
 */
export const EMBEDDING_MODEL = env.OPENAI_EMBEDDING_MODEL;

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Rough token count estimate using the characters ÷ 4 heuristic.
 *
 * OpenAI tokenizers (cl100k_base / o200k_base) average ≈ 4 chars per token
 * for typical English prose.  Code and non-ASCII text can be 2–3 chars/token.
 *
 * Use this for cheap budget checks (e.g. "will this fit in the context window?"),
 * NOT for billing.  Exact counts come from `response.usage` in non-streaming
 * completions, or from the `x-openai-usage` extension in streaming calls.
 *
 * @param text — The string to estimate.
 * @returns Estimated token count (always ≥ 1 for non-empty input).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Maps OpenAI SDK errors to user-facing strings that are safe to surface in
 * the chat UI.  Never leaks API keys, internal URLs, or stack traces.
 *
 * Call this inside a catch block around any openaiClient call:
 *
 *   try {
 *     const stream = await openaiClient.chat.completions.create({ ... });
 *     ...
 *   } catch (err) {
 *     const userMessage = classifyOpenAIError(err);
 *     write(errorChunk(userMessage));
 *   }
 *
 * The SDK already retried 429 and 5xx twice before reaching this handler,
 * so the errors that arrive here are genuine failures, not transient blips.
 */
export function classifyOpenAIError(err: unknown): string {
  if (!(err instanceof OpenAI.APIError)) {
    // Network-level failure (DNS, TLS, timeout) or unexpected throw.
    // Log for ops visibility without exposing internals to the user.
    console.error("[OpenAI] Unexpected error:", err);
    return "An unexpected error occurred. Please try again.";
  }

  switch (err.status) {
    case 401:
      // Invalid or revoked API key — server misconfiguration, not user error.
      // Log prominently; this must not reach users as an auth message.
      console.error("[OpenAI] 401 Authentication error — verify OPENAI_API_KEY");
      return "The assistant is temporarily unavailable. Please contact support.";

    case 429:
      // Rate limit exceeded (RPM, TPM, or daily quota).
      // The SDK already exhausted its built-in retries before landing here.
      console.warn("[OpenAI] 429 Rate limit reached");
      return (
        "The assistant is experiencing high demand. " +
        "Please wait a moment and try again."
      );

    case 400: {
      const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
      if (msg.includes("context_length_exceeded") || msg.includes("maximum context length")) {
        // The combined system + history + context block exceeded the model limit.
        // Extremely unlikely with gpt-4o-mini (128k) but included defensively.
        console.warn("[OpenAI] 400 Context length exceeded");
        return (
          "Your conversation is too long to process. " +
          "Please start a new session or ask a shorter question."
        );
      }
      console.error("[OpenAI] 400 Bad request:", err.message);
      return "The request could not be processed. Please rephrase your question.";
    }

    case 500:
    case 503:
      console.error(`[OpenAI] ${err.status} Service error`);
      return "The assistant is temporarily unavailable. Please try again shortly.";

    default:
      console.error(`[OpenAI] API error ${err.status}:`, err.message);
      return "The assistant encountered an error. Please try again.";
  }
}
