/**
 * lib/session/queryRewriter.ts — follow-up query resolution for the HR chatbot.
 *
 * Problem
 * ───────
 * When a user asks "Does that apply to contractors?" the word "that" carries
 * no semantic content on its own.  The embedding of "Does that apply to
 * contractors?" produces a vector that matches nothing specific in the policy
 * store — the retriever returns unrelated results or nothing at all.
 *
 * Solution
 * ────────
 * 1. Detect whether the message contains vague back-references
 *    ("that", "it", "this policy", etc.) using a curated set of patterns.
 * 2. If no vague references → pass the query through unchanged.
 * 3. If vague references AND conversation history exists:
 *      Extract the topic of the last assistant reply and prepend it,
 *      producing a self-contained query the retriever can embed meaningfully.
 * 4. If vague references AND no history to resolve them:
 *      Return a clarification prompt — ask the user what they are referring to.
 *
 * Critical constraint: memory must not override retrieved evidence
 * ─────────────────────────────────────────────────────────────────
 * The rewritten query is used ONLY for RAG retrieval (the embedding step).
 * The original user message and the full conversation history both reach the
 * LLM unchanged — grounding stays in the retrieved policy excerpts, not in
 * what the model "remembers" from earlier turns.
 *
 * No API calls — all logic is local string manipulation (~0 ms).
 */

import type { ChatMessage } from "@/types";

// ── Result type ───────────────────────────────────────────────────────────────

/**
 * Discriminated union returned by rewriteQuery().
 *
 *   standalone    — no vague references detected; use the original message.
 *   rewritten     — references resolved from history; use `query` for retrieval.
 *   clarification — references are ambiguous and cannot be resolved; ask the
 *                   user for more context before proceeding.
 *
 * Only the `query` field of `standalone` and `rewritten` is used for RAG.
 * The original user message is always preserved for the LLM prompt and session.
 */
export type RewriteResult =
  | { type: "standalone";    query: string   }
  | { type: "rewritten";     query: string   }
  | { type: "clarification"; prompt: string  };

// ── Clarification message ─────────────────────────────────────────────────────

/**
 * Shown to the user when a follow-up reference cannot be resolved because
 * there is no prior conversation to anchor it to.
 *
 * Exported so tests can assert on exact wording without string literals.
 */
export const CLARIFICATION_PROMPT =
  "I'd be happy to help! I'm not sure what you're referring to though. " +
  "Could you give me a bit more context? For example, which policy or topic " +
  "were you asking about?";

// ── Vague reference patterns ──────────────────────────────────────────────────

/**
 * Patterns that indicate the message contains an unresolved back-reference
 * to something from a prior conversation turn.
 *
 * Design principles:
 *   • Match at the START of the message (^) where possible — pronoun subjects
 *     at the head of a sentence are almost always back-references.
 *   • Prefer specific word sequences over single-word matches to avoid false
 *     positives on legitimate specific questions.
 *   • "the vacation policy" is NOT a vague reference (specific noun phrase);
 *     "this policy" or "that rule" IS (anaphoric determiners without a noun).
 *   • All patterns use the case-insensitive flag.
 *
 * Tested non-triggering cases:
 *   "What is the overtime policy?"           — "the" + specific noun, passes
 *   "Can I carry over unused vacation days?" — no pronoun, passes
 *   "That's interesting"                     — "that's" not followed by a verb, passes
 */
const VAGUE_PATTERNS: RegExp[] = [
  // Auxiliary verb + bare pronoun subject: "Does it cover…", "Is that right?"
  /^(is|are|was|were|do|does|did|has|have|had|can|could|will|would|should|may|might)\s+(it|that|this|they|those|them)\b/i,

  // Anaphoric determiners before policy nouns: "this policy", "those rules"
  // Deliberately excludes "the" — "the sick-leave policy" is specific, not vague.
  /\b(this|that|these|those)\s+(policy|policies|rule|rules|requirement|requirements|regulation|section|provision|clause|guideline|benefit|entitlement)\b/i,

  // "What about [pronoun]": "What about that?", "What about it?"
  /^what\s+about\s+(it|that|this|them|those)\b/i,

  // Pronoun as subject followed by a reporting verb: "It says…", "That means…"
  /^(it|that|this|they|those|them)\s+(says?|means?|states?|applies?|covers?|allows?|requires?|includes?|excludes?|refers?)\b/i,

  // Comparative continuation: "Does the same apply to…?"
  /\bthe\s+same\b/i,

  // Continuation conjunctions: "And does it…", "And what about…"
  /^and\s+(is|are|does|do|can|will|would|should|has|have|what|how|why)\b/i,

  // "How does that work?", "Why would it apply?"
  /^(how|why)\s+(does|would|could|should|did|is|was)\s+(it|that|this|they|those)\b/i,

  // "Tell me more about it", "More about that", "Explain it to me"
  /\b(more\s+about|tell\s+me\s+(more|about)|explain\s+(it|that|this|them|those))\b/i,
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the message contains at least one vague back-reference
 * that would produce a meaningless embedding on its own.
 */
function hasVagueReference(message: string): boolean {
  const trimmed = message.trim();
  return VAGUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Extracts a topic hint from the most recent assistant message in history.
 *
 * Strategy:
 *   1. Walk backwards through history to find the last assistant turn.
 *   2. Strip model-inserted "Source: …" lines (they carry citation metadata,
 *      not semantic content for embedding).
 *   3. Take the first complete sentence — this is typically the direct answer
 *      which names the policy and the specific point being made.
 *   4. Truncate to MAX_TOPIC_CHARS to keep the rewritten query focused.
 *
 * Returns null when:
 *   - There are no assistant messages in history.
 *   - The last assistant message is too short to provide context (< MIN_LENGTH).
 *   - The message consists only of Source: lines or the clarification prompt.
 */
const MAX_TOPIC_CHARS = 120;
const MIN_TOPIC_LENGTH = 15;

function extractTopicFromHistory(history: ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;

    // Strip Source: lines inserted by the model per SECTION_CITATIONS
    const cleaned = msg.content
      .split("\n")
      .filter((line) => !/^source:/i.test(line.trim()))
      .join("\n")
      .trim();

    if (cleaned.length < MIN_TOPIC_LENGTH) continue;

    // Extract the first sentence (up to '.', '!', or '?')
    const sentenceMatch = cleaned.match(/^[^.!?]+[.!?]/);
    const firstSentence = sentenceMatch
      ? sentenceMatch[0].trim()
      : cleaned.slice(0, MAX_TOPIC_CHARS);

    const topic = firstSentence.slice(0, MAX_TOPIC_CHARS).trim();
    if (topic.length >= MIN_TOPIC_LENGTH) return topic;
  }

  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Rewrites a follow-up message into a self-contained retrieval query.
 *
 * Call this after loading session memory and before RAG retrieval.
 * Use `result.query` for embedding/retrieval; keep the original `message`
 * for everything else (LLM prompt, session history, logging).
 *
 * @param message — Sanitized user message (after guardrails passed).
 * @param history — Recent conversation turns from getSessionMemory().
 *
 * @returns RewriteResult — see the type definition above.
 *
 * Examples
 * ────────
 * No vague reference:
 *   "How many vacation days do I get per year?"
 *   → { type: "standalone", query: "How many vacation days do I get per year?" }
 *
 * Resolved from history (last assistant: "Vacation leave accrues at 1.5 days…"):
 *   "Does that apply to part-time employees?"
 *   → { type: "rewritten",
 *       query: "Vacation leave accrues at 1.5 days… — Does that apply to part-time employees?" }
 *
 * Ambiguous — no history:
 *   "Does that apply to contractors?"
 *   → { type: "clarification", prompt: "I'd be happy to help!…" }
 */
export function rewriteQuery(
  message: string,
  history: ChatMessage[]
): RewriteResult {
  // Fast path: no vague references → use the message as-is.
  if (!hasVagueReference(message)) {
    return { type: "standalone", query: message };
  }

  // Vague reference detected — try to resolve from history.
  const topic = extractTopicFromHistory(history);

  if (!topic) {
    // No usable history to anchor the reference — ask for clarification.
    return { type: "clarification", prompt: CLARIFICATION_PROMPT };
  }

  // Combine the topic context with the user's follow-up.
  // The em-dash separator signals to the embedding model that the second
  // clause is a question about the subject described in the first clause.
  const query = `${topic} — ${message}`;
  return { type: "rewritten", query };
}
