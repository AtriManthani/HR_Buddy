/**
 * lib/api/structuredResponseValidator.ts — validates StructuredResponse before
 * it is serialised into the NDJSON metadata chunk.
 *
 * Why validate here?
 * ──────────────────
 * TypeScript catches type errors at compile time, but at runtime the fields of
 * StructuredResponse come from multiple sources:
 *   - `answer` and `explanation` from parseModelOutput() (model text)
 *   - `relatedPolicies` from deriveRelatedPolicies() (chunk metadata)
 *   - `refusal` from route logic
 *
 * If any source produces an unexpected value (empty string, wrong type, array
 * of malformed objects), malformed data would enter the NDJSON stream and
 * potentially cause client-side rendering errors.  This module provides a
 * final coercion pass that guarantees the client always receives a well-formed
 * StructuredResponse, regardless of what upstream code produced.
 *
 * Behaviour
 * ─────────
 * - `answer`          : must be a non-empty string; falls back to ANSWER_FALLBACK
 * - `explanation`     : must be a non-empty string if present; otherwise dropped
 * - `relatedPolicies` : must be an array; each entry must have a non-empty
 *                       string `title` and `category`; invalid entries are
 *                       dropped silently; empty array is treated as absent
 * - `refusal`         : must be boolean if present; otherwise dropped
 *
 * All coercions are logged with console.warn so the development team can
 * investigate upstream issues without user-visible breakage.
 */

import type { StructuredResponse } from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Fallback used when `answer` is missing, not a string, or empty.
 * Matches the tone of REFUSAL_MESSAGES to give a consistent voice.
 */
const ANSWER_FALLBACK = "Something went wrong generating a response. Please try again.";

// ── Internal helpers ──────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validates and coerces a StructuredResponse before it is sent to the client.
 *
 * Returns a new object — the input is never mutated.  Always returns a valid
 * StructuredResponse with at minimum a non-empty `answer` string.
 *
 * @param raw — The assembled StructuredResponse (may be partially malformed)
 * @returns     A well-formed StructuredResponse safe to serialise to NDJSON
 */
export function validateStructuredResponse(raw: StructuredResponse): StructuredResponse {
  const issues: string[] = [];

  // ── answer ────────────────────────────────────────────────────────────────
  let answer: string;
  if (isNonEmptyString(raw.answer)) {
    answer = raw.answer;
  } else {
    issues.push(`answer invalid (type=${typeof raw.answer}, value=${JSON.stringify(raw.answer)})`);
    answer = ANSWER_FALLBACK;
  }

  // ── explanation ───────────────────────────────────────────────────────────
  let explanation: string | undefined;
  if (raw.explanation !== undefined) {
    if (isNonEmptyString(raw.explanation)) {
      explanation = raw.explanation;
    } else {
      issues.push(`explanation dropped (type=${typeof raw.explanation})`);
      // Drop it — undefined is correct when absent
    }
  }

  // ── relatedPolicies ───────────────────────────────────────────────────────
  let relatedPolicies: StructuredResponse["relatedPolicies"];
  if (raw.relatedPolicies !== undefined) {
    if (!Array.isArray(raw.relatedPolicies)) {
      issues.push("relatedPolicies dropped (not an array)");
    } else {
      const valid = raw.relatedPolicies.filter((entry) => {
        const e = entry as unknown as Record<string, unknown>;
        if (
          typeof e !== "object" ||
          e === null ||
          !isNonEmptyString(e.title) ||
          !isNonEmptyString(e.category)
        ) {
          issues.push(`relatedPolicy entry dropped: ${JSON.stringify(entry)}`);
          return false;
        }
        return true;
      }) as StructuredResponse["relatedPolicies"];

      // Only set if at least one valid entry remains
      if (valid && valid.length > 0) {
        relatedPolicies = valid;
      }
    }
  }

  // ── refusal ───────────────────────────────────────────────────────────────
  let refusal: boolean | undefined;
  if (raw.refusal !== undefined) {
    if (typeof raw.refusal === "boolean") {
      refusal = raw.refusal;
    } else {
      issues.push(`refusal coerced (type=${typeof raw.refusal})`);
      refusal = Boolean(raw.refusal);
    }
  }

  // ── Log any coercions ─────────────────────────────────────────────────────
  if (issues.length > 0) {
    console.warn(
      "[structuredResponseValidator] Coerced fields in StructuredResponse:\n" +
      issues.map((i) => `  • ${i}`).join("\n")
    );
  }

  return { answer, explanation, relatedPolicies, refusal };
}
