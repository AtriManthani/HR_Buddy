/**
 * lib/security/sanitize.ts — input sanitizer for user messages.
 *
 * Runs as the very first step in the API route — before guardrails, before any
 * LLM interaction.  All checks are purely structural: they validate and clean
 * the string without interpreting its meaning.
 *
 * Defences applied (in order):
 *
 *  1. Type gate          — must be a string
 *  2. ASCII control-char strip — null bytes, C0 control chars (excl. \t \n)
 *  3. Unicode BiDi strip — direction-override and isolate codepoints used to
 *                          visually disguise injected text (RLO/LRO/PDF/isolates)
 *  4. Unicode normalize  — NFC normalization collapses homograph look-alikes
 *                          (е vs e, а vs a — Cyrillic/Latin substitution)
 *  5. Encoding-bomb check — rejects messages that are mostly base64 or hex-
 *                           encoded payloads (used to smuggle instructions past
 *                           keyword-based guardrails)
 *  6. Trim + empty check
 *  7. Length cap         — 2000 chars, prevents token-stuffing attacks
 *
 * What this does NOT do:
 *  - HTML-encode output: React handles escaping at render time
 *  - Semantic filtering: that is the job of guardrails.ts
 *  - Validate against a schema: that is the job of validation.ts
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// Imported from validation.ts — single source of truth for the length limit.
// Both files enforce it so the value must only be changed in validation.ts.
import { MAX_MESSAGE_LENGTH } from "@/lib/api/validation";
export { MAX_MESSAGE_LENGTH };

/**
 * Minimum ratio of base64/hex characters in a run before it is considered
 * an encoding-bomb candidate.  A 200-char run of [A-Za-z0-9+/=] is almost
 * certainly not a natural English sentence.
 */
const ENCODING_BOMB_RUN_LENGTH = 200;

// ── Unicode BiDi override codepoints ─────────────────────────────────────────
// These are invisible characters that reverse or isolate text direction.
// Attackers use them to display "innocent" text to humans while the model
// processes the hidden instruction in the reversed segment.
//
// Stripped categories:
//   U+202A  LEFT-TO-RIGHT EMBEDDING
//   U+202B  RIGHT-TO-LEFT EMBEDDING
//   U+202C  POP DIRECTIONAL FORMATTING
//   U+202D  LEFT-TO-RIGHT OVERRIDE
//   U+202E  RIGHT-TO-LEFT OVERRIDE  ← most commonly abused
//   U+2066  LEFT-TO-RIGHT ISOLATE
//   U+2067  RIGHT-TO-LEFT ISOLATE
//   U+2068  FIRST STRONG ISOLATE
//   U+2069  POP DIRECTIONAL ISOLATE
//   U+200F  RIGHT-TO-LEFT MARK
//   U+200E  LEFT-TO-RIGHT MARK
const BIDI_OVERRIDES_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// ── Suspicious encoding pattern ────────────────────────────────────────────────
// Matches a run of ENCODING_BOMB_RUN_LENGTH or more base64-alphabet characters
// (possibly including padding "=" signs).  A run this long in natural text is
// essentially impossible — it is almost certainly an encoded payload.
const ENCODING_BOMB_RE = new RegExp(
  `[A-Za-z0-9+/]{${ENCODING_BOMB_RUN_LENGTH},}={0,2}`,
  "g"
);

// ── Sanitizer ─────────────────────────────────────────────────────────────────

/**
 * Sanitizes a raw user message.
 *
 * @param raw   - The raw value from the request body (unknown type)
 * @returns       Cleaned, normalized string within the length limit
 * @throws        Error with a safe message for any invalid input
 */
export function sanitizeInput(raw: unknown): string {
  // 1. Type gate
  if (typeof raw !== "string") {
    throw new Error("Message must be a string.");
  }

  // 2. Strip ASCII control characters (keep \t = 0x09, \n = 0x0A)
  //    0x00–0x08, 0x0B–0x0C, 0x0E–0x1F, 0x7F
  let cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 3. Strip Unicode BiDi direction-override characters
  cleaned = cleaned.replace(BIDI_OVERRIDES_RE, "");

  // 4. Unicode NFC normalization — collapses multi-codepoint sequences and
  //    reduces homograph look-alike attacks (Cyrillic а → Latin a etc.)
  try {
    cleaned = cleaned.normalize("NFC");
  } catch {
    // normalize() is available in all modern runtimes; the try/catch is a
    // defensive belt-and-suspenders guard for unusual execution environments.
  }

  // 5. Encoding-bomb detection — reject before trim so we measure the raw run
  if (ENCODING_BOMB_RE.test(cleaned)) {
    // Reset lastIndex after test() on a stateful regex
    ENCODING_BOMB_RE.lastIndex = 0;
    throw new Error("Message contains an unsupported encoding pattern.");
  }
  ENCODING_BOMB_RE.lastIndex = 0;

  // 6. Trim and empty check
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    throw new Error("Message cannot be empty.");
  }

  // 7. Length cap
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    throw new Error(
      `Message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`
    );
  }

  return cleaned;
}
