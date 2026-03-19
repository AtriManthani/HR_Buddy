/**
 * lib/openai/parseModelOutput.ts — converts raw LLM text into a structured response.
 *
 * Why post-stream parsing instead of JSON mode?
 * ─────────────────────────────────────────────
 * JSON mode (response_format: { type: "json_object" }) would require the model
 * to stream raw JSON tokens.  Employees would see `{"answer":"` appearing in
 * the chat window — a broken UX.  Post-stream parsing preserves the natural
 * text streaming experience while still delivering structured data.
 *
 * How it works
 * ────────────
 * The system prompt (SECTION_FORMAT in systemPrompt.ts) instructs the model to
 * structure its output as:
 *
 *   [Direct answer — 1–3 sentences]
 *
 *   [Supporting detail — elaboration, conditions, exceptions]
 *
 *   For guidance specific to your situation, consider speaking directly with HR.
 *   Source: [Policy Title] — [Section Name]
 *
 * This module:
 *   1. Strips "Source: ..." lines (redundant — Citation cards come from the
 *      metadata chunk, not from parsed model text).
 *   2. Strips the complexity recommendation note (redundant — the Recommendation
 *      banner is generated programmatically by buildRecommendations() in route.ts).
 *   3. Splits the remaining text at paragraph boundaries.
 *   4. Maps paragraph[0] → answer, paragraphs[1..n] → explanation.
 *   5. Enforces length caps so a runaway model response cannot produce
 *      unbounded output that fills the client's DOM.
 *
 * Robustness
 * ──────────
 * The model does not always produce perfectly formatted output.  All branches
 * have graceful fallbacks:
 *   - Empty or whitespace-only output → answer = EMPTY_FALLBACK
 *   - Single paragraph → answer = that paragraph, explanation = undefined
 *   - Stripping removes everything → fall back to raw fullContent (truncated)
 *   - answer or explanation exceeds length cap → truncated at word boundary
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The structured form of the model's text output after post-processing.
 *
 * Maps directly to the answer + explanation fields of StructuredResponse.
 * relatedPolicies and refusal are set by the route from chunk metadata.
 */
export interface ParsedModelOutput {
  /** The direct answer to the employee's question. Always present and non-empty. */
  answer: string;
  /**
   * Supporting elaboration: policy conditions, exceptions, or context.
   * Present only when the model produced more than one content paragraph.
   */
  explanation?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum characters for the `answer` field sent to the client.
 * gpt-4o-mini rarely produces answers this long for policy questions, but
 * the cap prevents a runaway or manipulated response filling the DOM.
 */
const MAX_ANSWER_LENGTH = 3_000;

/**
 * Maximum characters for the `explanation` field sent to the client.
 * Longer elaboration is less common; cap generously to avoid false truncation.
 */
const MAX_EXPLANATION_LENGTH = 6_000;

/**
 * Shown when the model returns an empty or unparseable response.
 * Matches the tone of REFUSAL_MESSAGES to give a consistent voice.
 */
const EMPTY_FALLBACK = "No response was generated. Please try again.";

// ── Strip patterns ────────────────────────────────────────────────────────────

/**
 * Lines the model inserts for readability that are redundant in the
 * structured response (both are rendered by dedicated UI components):
 *
 *   SOURCE_LINE_RE  — "Source: Vacation Leave Policy — Section I"
 *   COMPLEXITY_RE   — "For guidance specific to your situation…"
 */
const SOURCE_LINE_RE = /^source:/i;
const COMPLEXITY_RE  = /^for guidance specific to your situation/i;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Removes meta-lines from the model output.
 *
 * Processes line-by-line so it handles both CRLF and LF line endings.
 * After filtering, collapses runs of 3+ blank lines to prevent gaps in
 * the rendered explanation section.
 */
function stripMetaLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !SOURCE_LINE_RE.test(t) && !COMPLEXITY_RE.test(t);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits cleaned text into non-empty paragraphs at double-newline boundaries.
 * Single newlines within a paragraph are preserved (the UI renders them as <br>).
 */
function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Truncates `text` to at most `maxLength` characters at the last word boundary.
 * Appends "…" when truncation occurs.
 */
function truncateAt(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cutoff = text.lastIndexOf(" ", maxLength);
  const boundary = cutoff > 0 ? cutoff : maxLength;
  return text.slice(0, boundary).trimEnd() + "…";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Converts the model's complete streamed text into a ParsedModelOutput.
 *
 * @param fullContent — The full concatenated text from the LLM stream.
 *                      Must be the complete response (called after streaming ends).
 * @returns ParsedModelOutput with `answer` always set (never empty) and
 *          `explanation` present only when additional content exists.
 */
export function parseModelOutput(fullContent: string): ParsedModelOutput {
  // ── Guard: empty stream ────────────────────────────────────────────────────
  if (!fullContent || !fullContent.trim()) {
    return { answer: EMPTY_FALLBACK };
  }

  const cleaned    = stripMetaLines(fullContent);
  const paragraphs = splitParagraphs(cleaned);

  // ── Fallback: stripping removed everything ─────────────────────────────────
  if (paragraphs.length === 0) {
    const raw = fullContent.trim();
    const answer = truncateAt(raw || EMPTY_FALLBACK, MAX_ANSWER_LENGTH);
    return { answer };
  }

  // ── Single paragraph → answer only ────────────────────────────────────────
  if (paragraphs.length === 1) {
    return { answer: truncateAt(paragraphs[0], MAX_ANSWER_LENGTH) };
  }

  // ── Multiple paragraphs → answer + explanation ────────────────────────────
  const [first, ...rest] = paragraphs;
  const answer      = truncateAt(first, MAX_ANSWER_LENGTH);
  const rawExplain  = rest.join("\n\n").trim();
  const explanation = rawExplain
    ? truncateAt(rawExplain, MAX_EXPLANATION_LENGTH)
    : undefined;

  return { answer, explanation };
}
