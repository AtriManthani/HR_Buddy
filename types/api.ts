/**
 * types/api.ts — HTTP contract types for POST /api/chat.
 *
 * Covers both sides of the wire:
 *   Request  — ChatRequest (body parsed by lib/api/validation.ts)
 *   Response — NDJSON stream of StreamChunk (discriminated union)
 *
 * Also includes internal pipeline helpers:
 *   PipelineContext       — passed through the server-side pipeline stages
 *   ChatCompletionMessage — OpenAI messages array element (avoids SDK import
 *                           in files that only need the type, not the client)
 *   ApiErrorResponse      — shape of non-streaming error JSON responses
 */

import type { Citation, Recommendation } from "./citations";
import type { StructuredResponse }        from "./response";
import type { ChatMessage }               from "./chat";

// ── Request ────────────────────────────────────────────────────────────────────

/**
 * Body of POST /api/chat.
 * Validated by lib/api/validation.ts before reaching the pipeline.
 */
export interface ChatRequest {
  /** The user's raw message text (max 2 000 chars after sanitization) */
  message: string;
  /**
   * UUID v4 from a previous response's metadata chunk.
   * Null on the very first request — the server will create a new session.
   */
  sessionId: string | null;
}

// ── Response stream (discriminated union) ─────────────────────────────────────

/**
 * A single token of streamed text from the assistant.
 * Emitted repeatedly during generation, one word-fragment at a time.
 */
export interface TokenChunk {
  type: "token";
  /** The text fragment to append to the in-progress assistant message */
  token: string;
}

/**
 * The final chunk sent after all tokens have been streamed.
 * Contains the full session state and structured response data.
 * The client should not render more tokens after receiving this.
 */
export interface MetadataChunk {
  type: "metadata";
  /** Server-assigned session ID — persist and echo back in future requests */
  sessionId: string;
  citations: Citation[];
  /**
   * Zero or more contextual recommendations for complex or multi-part answers.
   * Empty array when no recommendations apply.
   */
  recommendations: Recommendation[];
  /** Fully structured breakdown of the answer for section-by-section rendering */
  structuredResponse: StructuredResponse;
}

/**
 * Sent when the server pipeline encounters an unrecoverable error.
 * The client should display the error message and offer a retry.
 */
export interface ErrorChunk {
  type: "error";
  error: string;
}

/**
 * Discriminated union of all NDJSON stream chunk shapes.
 *
 * Narrowing pattern (in client code):
 *   if (chunk.type === "token")    { /* TokenChunk    *\/ }
 *   if (chunk.type === "metadata") { /* MetadataChunk *\/ }
 *   if (chunk.type === "error")    { /* ErrorChunk    *\/ }
 */
export type StreamChunk = TokenChunk | MetadataChunk | ErrorChunk;

// ── Non-streaming error response ──────────────────────────────────────────────

/**
 * Shape of the JSON body returned for 4xx/5xx errors that occur
 * before the stream can be opened (e.g. validation failures).
 */
export interface ApiErrorResponse {
  error: string;
}

// ── Internal pipeline types ───────────────────────────────────────────────────

/**
 * Context passed through the server-side pipeline stages in runPipeline().
 * Constructed after session resolution; consumed by RAG and LLM steps.
 */
export interface PipelineContext {
  /** Sanitized, guardrail-cleared user message */
  message: string;
  /** Resolved session ID (always a valid UUID at this point) */
  sessionId: string;
  /** Trimmed conversation history for the LLM messages array */
  history: ChatMessage[];
  /**
   * Returns milliseconds elapsed since the top-level POST handler was entered.
   * Used to emit end-to-end latency in structured log events.
   * Optional so that test helpers that construct PipelineContext directly
   * do not need to supply a timer.
   */
  requestTimer?: () => number;
}

/**
 * A single element of the OpenAI chat completions messages array.
 *
 * Mirrors `ChatCompletionMessageParam` from the openai SDK, typed locally
 * so that files building the messages array (lib/openai/prompts.ts) do not
 * need to import the SDK just for the type.
 */
export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
