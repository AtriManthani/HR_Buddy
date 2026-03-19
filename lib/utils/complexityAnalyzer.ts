/**
 * Complexity analyzer — decides whether an answer warrants a recommendation banner.
 *
 * Responsibilities:
 * - Examines the retrieved chunks to assess policy complexity
 * - Returns a Recommendation object when the policy is long or multi-part
 * - Never triggers actions — only produces informational text
 *
 * Heuristics (configurable):
 *   - More than 3 distinct source sections retrieved → complex
 *   - Total retrieved text > 2000 characters → complex
 *   - Policy title contains keywords: "procedure", "framework", "matrix" → complex
 *
 * The recommendation text is generic and HR-directed.
 * It MUST NOT contain links, email addresses, or system names.
 */

import type { RetrievedChunk, Recommendation } from "@/types";

/** Keywords in policy titles that signal complexity */
const COMPLEX_TITLE_KEYWORDS = [
  "procedure",
  "framework",
  "matrix",
  "guideline",
  "comprehensive",
  "multi-stage",
];

const COMPLEX_CHAR_THRESHOLD = 2000;
const COMPLEX_SECTION_THRESHOLD = 3;

/**
 * Analyzes retrieved chunks and returns a recommendation if the policy is complex.
 *
 * @param chunks - Top-k retrieved chunks for the current query
 * @returns A Recommendation object, or null if no recommendation is needed
 */
export function analyzeComplexity(
  chunks: RetrievedChunk[]
): Recommendation | null {
  // TODO (Phase 6): Implement heuristics
  // 1. Count distinct sections across chunks
  // 2. Sum total character count
  // 3. Check policy title keywords
  // 4. If any heuristic fires → return Recommendation
  return null; // placeholder — no recommendation until implemented
}
