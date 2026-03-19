/**
 * lib/rag/recommendations.ts — recommendation engine for the HR Policy Chatbot.
 *
 * Produces zero or more contextual Recommendation objects from the retrieved
 * policy chunks and the streamed answer text.  Recommendations are purely
 * informational — they suggest the employee read a related section, check
 * eligibility, gather documentation, or speak with HR.  They NEVER trigger
 * actions, submit requests, or claim to make decisions.
 *
 * Signals evaluated (in priority order)
 * ──────────────────────────────────────
 *  eligibility   — chunk text contains eligibility/qualification keywords
 *                  (e.g. "eligible", "qualify", "entitled", "criteria")
 *  documentation — chunk text mentions forms, submissions, or evidence
 *                  (e.g. "form", "submit", "attach", "supporting documents")
 *  cross-policy  — 3+ distinct source documents were retrieved
 *  complexity    — 4+ distinct sections across retrieved chunks
 *  low-confidence— top chunk score < LOW_CONF_THRESHOLD (retrieved but marginal)
 *
 * Each signal fires at most once, so the maximum returned array length is 5.
 * Signals are tested in the order above; once fired they do not repeat.
 *
 * Design rules
 * ────────────
 * - Read-only: accepts already-computed data, never fetches or mutates.
 * - Deterministic: same inputs → same outputs (no random, no async).
 * - Conservative: false positives (showing a banner when unnecessary) are
 *   acceptable; false negatives (hiding it when needed) should be minimised.
 */

import type { Citation, Recommendation } from "@/types";

// ── Thresholds ─────────────────────────────────────────────────────────────────

/** Minimum number of unique source files to trigger the cross-policy signal. */
const CROSS_POLICY_DOC_THRESHOLD = 3;

/** Minimum number of unique sections to trigger the complexity signal. */
const COMPLEXITY_SECTION_THRESHOLD = 4;

/**
 * Top-chunk score below this value triggers the low-confidence signal.
 * Chosen conservatively: most on-topic matches score ≥ 0.82.
 */
const LOW_CONF_THRESHOLD = 0.82;

// ── Keyword sets ────────────────────────────────────────────────────────────────

/**
 * Eligibility keywords: presence in chunk text suggests the answer involves
 * qualifying conditions that the employee should verify against their situation.
 */
const ELIGIBILITY_KEYWORDS = [
  "eligible",
  "eligibility",
  "qualify",
  "qualification",
  "entitled",
  "entitlement",
  "criteria",
  "requirement",
  "requirements",
  "must meet",
  "subject to",
  "provided that",
  "depending on",
];

/**
 * Documentation keywords: presence suggests the employee may need to complete
 * a form, gather supporting evidence, or follow a submission process.
 */
const DOCUMENTATION_KEYWORDS = [
  "form",
  "application",
  "submit",
  "submission",
  "attach",
  "supporting document",
  "documentation",
  "provide evidence",
  "notify",
  "written notice",
  "written request",
  "certificate",
  "proof",
  "approval",
];

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Case-insensitive substring search for any keyword in text. */
function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Concatenates the excerpt text from all citations into a single string
 * for keyword scanning.  Excerpts are already ≤ 300 chars each, so the
 * total is bounded and safe to scan linearly.
 */
function allExcerpts(citations: Citation[]): string {
  return citations.map((c) => c.excerpt).join(" ");
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Derives contextual Recommendation objects from retrieved citations and
 * the completed answer text.
 *
 * Call after buildCitationObjects() and after the LLM stream has finished
 * (so the answer string is available for keyword scanning if needed).
 *
 * @param citations  — Citation[] built by buildCitationObjects(), score-sorted.
 * @param _answer    — Full streamed answer text (reserved for future signals).
 * @returns          — Array of 0–5 Recommendation objects, most important first.
 */
export function buildRecommendations(
  citations: Citation[],
  _answer: string
): Recommendation[] {
  if (citations.length === 0) return [];

  const results: Recommendation[] = [];
  const excerptText = allExcerpts(citations);

  // ── Signal 1: eligibility ──────────────────────────────────────────────────

  if (containsAny(excerptText, ELIGIBILITY_KEYWORDS)) {
    results.push({
      type:     "eligibility",
      headline: "Check your eligibility criteria",
      detail:
        "The relevant policy includes eligibility conditions. " +
        "Verify that you meet the specific requirements for your role, " +
        "length of service, or employment type before proceeding.",
    });
  }

  // ── Signal 2: documentation ────────────────────────────────────────────────

  if (containsAny(excerptText, DOCUMENTATION_KEYWORDS)) {
    results.push({
      type:     "documentation",
      headline: "Review required documentation",
      detail:
        "This policy may require you to complete a form, submit a written " +
        "request, or provide supporting evidence. Check the full policy " +
        "document to confirm what you need to prepare.",
    });
  }

  // ── Signal 3: cross-policy (3+ source documents) ──────────────────────────

  const uniqueDocs = new Set(citations.map((c) => c.sourceFile)).size;
  if (uniqueDocs >= CROSS_POLICY_DOC_THRESHOLD) {
    results.push({
      type:     "cross-policy",
      headline: "Speak with HR for guidance across policy areas",
      detail:
        "Your question touches " +
        uniqueDocs +
        " different policy documents. An HR representative can help you " +
        "understand how these policies interact in your specific situation.",
    });
  }

  // ── Signal 4: complexity (4+ distinct sections) ───────────────────────────

  const uniqueSections = new Set(
    citations.map((c) => `${c.sourceFile}::${c.section ?? ""}`)
  ).size;
  if (uniqueSections >= COMPLEXITY_SECTION_THRESHOLD) {
    results.push({
      type:     "complexity",
      headline: "Read related policy sections",
      detail:
        "The answer draws on " +
        uniqueSections +
        " policy sections. For the full picture — including exceptions and " +
        "step-by-step procedures — review each referenced section in the " +
        "source documents listed above.",
    });
  }

  // ── Signal 5: low-confidence (marginal top score) ─────────────────────────

  const topScore = citations[0]?.score ?? 1;
  if (topScore < LOW_CONF_THRESHOLD) {
    results.push({
      type:     "low-confidence",
      headline: "Policy match may not fully address your situation",
      detail:
        "The retrieved policy sections may only partially cover your question. " +
        "If this answer doesn't match your circumstances, contact HR directly " +
        "for a more tailored response.",
    });
  }

  return results;
}
