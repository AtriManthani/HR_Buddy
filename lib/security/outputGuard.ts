/**
 * lib/security/outputGuard.ts — Layer 3: post-generation output validation.
 *
 * Runs on the completed assistant response (fullContent) before metadata is
 * assembled and before the session is persisted.  Token streaming is already
 * done at this point — this layer cannot suppress already-streamed tokens,
 * but it can:
 *
 *   (a) Detect if the model was manipulated into leaking system-prompt content
 *       or including raw instruction artifacts in its reply.
 *   (b) Strip NDJSON-like fragments that could confuse the client-side stream
 *       parser if they appear in the prose.
 *   (c) Flag anomalous output for server-side logging without exposing details
 *       to the client.
 *
 * This layer does NOT modify the streamed text — the client has already
 * rendered it.  It operates on `fullContent` purely for:
 *   • Session persistence: the cleaned version is stored in memory
 *   • Server logging: flagged output triggers a console.warn
 *
 * What it detects
 * ───────────────
 *  NDJSON injection    — lines starting with {"type": that look like stream
 *                        chunks injected into the prose (prototype pollution)
 *  Instruction leakage — output begins with or contains "RULE N —" headings,
 *                        which would mean the model regurgitated prompt text
 *  Delimiter leakage   — LLM format tokens ([INST], <<SYS>>, <|im_start|>)
 *                        that signal the model was re-anchored mid-generation
 *  Confidentiality key — phrases like "my instructions are" or "system prompt"
 *                        followed by a colon, suggesting partial disclosure
 *
 * Safe-by-default: if a detection fires, `sanitizedContent` still returns the
 * original text (the user already saw it).  Only `flagged` is set to true so
 * the operator can review logs and tighten the system prompt or guardrails.
 */

// ── Detection patterns ────────────────────────────────────────────────────────

/** Lines that look like NDJSON stream chunks injected into prose output. */
const NDJSON_FRAGMENT_RE = /^\s*\{"type"\s*:/m;

/**
 * The model regurgitating system-prompt section headers verbatim.
 * These start with "RULE N —" (the format used in systemPrompt.ts).
 */
const INSTRUCTION_HEADER_RE = /\bRULE\s+\d+\s+[—–-]/;

/** LLM format-token delimiters that should never appear in output prose. */
const DELIMITER_LEAK_RE = /\[INST\]|\[\/INST\]|<<SYS>>|<\/s>|<\|im_start\|>|<\|im_end\|>/i;

/**
 * Phrases that suggest the model may be disclosing its configuration.
 * Checked case-insensitively with a following colon or quote, which
 * indicates the model is about to elaborate rather than merely mentioning
 * the term in a general policy context.
 */
const DISCLOSURE_SIGNAL_RE =
  /\b(my\s+instructions?\s+are|my\s+system\s+prompt\s+(is|says)|i\s+was\s+told\s+to|i\s+am\s+instructed\s+to)\s*[:"']/i;

// ── Result type ───────────────────────────────────────────────────────────────

export interface OutputGuardResult {
  /**
   * The content to persist in session memory and use for metadata assembly.
   * Identical to the input in the current implementation — the streamed text
   * cannot be recalled, so we preserve it as-is and rely on logging.
   */
  sanitizedContent: string;
  /** True if any suspicious pattern was detected in the model output. */
  flagged: boolean;
  /** List of detection reasons — populated when flagged is true. */
  reasons: string[];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Validates the completed model response for output-side security signals.
 *
 * Call this after the OpenAI stream has finished and `fullContent` is complete,
 * before storing the turn in session memory.
 *
 * @param fullContent - The complete streamed model response text.
 * @returns             OutputGuardResult with flagged status and reasons.
 */
export function validateModelOutput(fullContent: string): OutputGuardResult {
  const reasons: string[] = [];

  if (NDJSON_FRAGMENT_RE.test(fullContent)) {
    reasons.push("ndjson-fragment");
  }
  if (INSTRUCTION_HEADER_RE.test(fullContent)) {
    reasons.push("instruction-header-leak");
  }
  if (DELIMITER_LEAK_RE.test(fullContent)) {
    reasons.push("delimiter-leak");
  }
  if (DISCLOSURE_SIGNAL_RE.test(fullContent)) {
    reasons.push("disclosure-signal");
  }

  const flagged = reasons.length > 0;

  if (flagged) {
    // Log the detection without echoing any part of the output content —
    // the output may contain sensitive instructions or PII.
    console.warn(
      `[outputGuard] Anomalous model output detected. ` +
      `Reasons: [${reasons.join(", ")}]. ` +
      `Content length: ${fullContent.length}. ` +
      `Review system prompt and guardrail patterns.`
    );
  }

  return { sanitizedContent: fullContent, flagged, reasons };
}
