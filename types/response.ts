/**
 * types/response.ts — model output and structured response shapes.
 *
 * These types describe what the LLM produces and how it is packaged
 * for the frontend. They are consumed by:
 *   - app/api/chat/route.ts (assembling the metadata chunk)
 *   - lib/openai/prompts.ts (describing the expected JSON schema)
 *   - components/chat/AssistantResponse.tsx (rendering sections)
 */

import type { Citation, Recommendation, RelatedPolicy } from "./citations";

// ── Model output ───────────────────────────────────────────────────────────────

/**
 * The raw JSON object the LLM is instructed to produce.
 *
 * The system prompt asks for a JSON object conforming to this interface.
 * Parsed in app/api/chat/route.ts (buildStructuredResponse) after streaming.
 * Falls back to { answer: fullContent } if JSON parsing fails.
 */
export interface ModelResponse {
  /** The direct, concise answer — always present */
  answer: string;
  /** Supporting context or elaboration the model chose to include */
  explanation?: string;
  /**
   * Related policies the model determined are worth mentioning.
   * Each entry maps to a category displayed in the sidebar.
   */
  relatedPolicies?: RelatedPolicy[];
}

// ── Structured response ────────────────────────────────────────────────────────

/**
 * The fully assembled response sent to the frontend in the metadata chunk.
 *
 * Produced by buildStructuredResponse() in app/api/chat/route.ts.
 * Rendered section-by-section by components/chat/AssistantResponse.tsx.
 * All fields except `answer` are optional — the UI hides any absent section.
 */
export interface StructuredResponse {
  /** The direct, concise answer — always present */
  answer: string;
  /** Supporting context or elaboration — hidden when absent */
  explanation?: string;
  /** Related policies the employee might also want to read */
  relatedPolicies?: RelatedPolicy[];
  /**
   * Set to true when the response is a guardrail refusal or out-of-scope reply.
   * The UI can use this flag to apply an amber / warning visual style.
   */
  refusal?: boolean;
}

// ── Out-of-scope handling ──────────────────────────────────────────────────────

/**
 * Result returned when a question cannot be answered from the policy corpus.
 *
 * Produced by the guardrail layer or when retrieval yields no relevant chunks.
 * Converted into a StructuredResponse with refusal: true before streaming.
 */
export interface OutOfScopeResult {
  /**
   * Category of the refusal, used to select the appropriate refusal message.
   *   "action"    — user asked the bot to do something (submit, approve, etc.)
   *   "injection" — prompt injection / jailbreak attempt detected
   *   "pii"       — request for another employee's personal data
   *   "no_context" — question is valid but no policy documents matched
   */
  category: "action" | "injection" | "pii" | "no_context";
  /** Human-readable explanation shown to the user */
  reason: string;
}
