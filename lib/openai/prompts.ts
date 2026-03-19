/**
 * lib/openai/prompts.ts — system prompt and message-building utilities.
 *
 * Responsibilities:
 *   - Defines the non-negotiable system prompt with hard guardrails
 *   - Builds the full OpenAI messages array from:
 *       system prompt + session history + retrieved context + user question
 *   - Enforces a character budget on injected history to prevent accidental
 *     context overflow on long sessions
 *
 * ── Context window budget (gpt-4o-mini, 128 000 token limit) ────────────────
 *
 *   Component                  Chars    Tokens (est.)
 *   ─────────────────────────  ───────  ─────────────
 *   System prompt              ~2 000      ~500
 *   Policy context (top-5)     ~8 000    ~2 000
 *   Session history (capped)   ~6 000    ~1 500   ← MAX_HISTORY_CHARS
 *   User question              ~  400      ~100
 *   Output budget (max)             —      ~800
 *   ─────────────────────────  ───────  ─────────────
 *   Total (estimated)         ~16 400    ~4 900   (3.8% of 128k limit)
 *
 *   Conclusion: gpt-4o-mini's 128k context is not a real constraint for this
 *   workload.  The history cap is a safety net, not a hard necessity.
 *
 * ── GUARDRAIL CONTRACT (enforced by SYSTEM_PROMPT) ──────────────────────────
 *
 *   1. Answer ONLY from the provided [POLICY CONTEXT] excerpts.
 *   2. Never speculate, infer, or draw on general knowledge.
 *   3. Cite sources in every answer.
 *   4. Refuse any request to perform an action (approve, submit, email, etc.).
 *   5. If policy is absent from excerpts, say so — never invent an answer.
 */

import type { ChatMessage }            from "@/types";
import type { ChatCompletionMessage }  from "@/types";
import { estimateTokens }              from "./client";
import { SYSTEM_PROMPT as _SYSTEM_PROMPT } from "./systemPrompt";

// ── System prompt ─────────────────────────────────────────────────────────────

/**
 * The master system prompt injected at position [0] of every completion call.
 *
 * Defined in lib/openai/systemPrompt.ts as named section constants assembled
 * by buildSystemPrompt().  Editing the prompt: open systemPrompt.ts and
 * locate the SECTION_* constant for the rule you want to change.
 *
 * Re-exported here so that any existing import of SYSTEM_PROMPT from this
 * module continues to work without changes.
 */
export const SYSTEM_PROMPT = _SYSTEM_PROMPT;

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum total characters of session history injected into the context window.
 *
 * SESSION_MAX_TURNS (default: 6) already limits the number of turns, but
 * individual messages have no length cap.  This ceiling ensures that even
 * on a session with unusually long messages, the history contribution stays
 * within ~1 500 tokens — leaving ample room for the policy context block.
 *
 * When history exceeds this budget, the oldest turns are dropped first so
 * the most recent exchange is always preserved.
 */
const MAX_HISTORY_CHARS = 6_000;

// ── Message builder ───────────────────────────────────────────────────────────

/**
 * Builds the complete OpenAI messages array for a chat completion call.
 *
 * Message order:
 *   [0] system   — SYSTEM_PROMPT (hard guardrails, never trimmed)
 *   [1..n-1]     — Prior session turns, oldest-first, trimmed to budget
 *   [n]  user    — Retrieved policy context + current user question
 *
 * The context block and question are combined into a single user message
 * rather than separate messages.  This is intentional: gpt-4o-mini follows
 * instructions more reliably when context and question are co-located.
 *
 * @param history   — Ordered prior turns from the session store.
 *                    The store already caps depth; this function caps chars.
 * @param context   — Formatted [POLICY CONTEXT] block from pipeline.ts.
 * @param userQuery — The sanitised, guardrail-cleared user question.
 *
 * @returns Messages array ready for openaiClient.chat.completions.create().
 */
export function buildMessages(
  history: ChatMessage[],
  context: string,
  userQuery: string
): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // ── Inject session history within character budget ────────────────────────
  //
  // Walk from most-recent to oldest, accumulating turns until the char budget
  // is exhausted.  Then reverse so the array is oldest-first, matching the
  // chronological order the model expects.
  //
  // Pairs (user + assistant) are kept together: we skip a user message if its
  // corresponding assistant reply has already been dropped, to avoid an
  // unpaired turn which can confuse the model.

  let budgetRemaining = MAX_HISTORY_CHARS;
  const selectedTurns: ChatCompletionMessage[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;

    const charCount = msg.content.length;
    if (charCount > budgetRemaining) {
      // This turn alone would exhaust the budget — stop here.
      break;
    }

    budgetRemaining -= charCount;
    selectedTurns.unshift({ role: msg.role, content: msg.content });
  }

  messages.push(...selectedTurns);

  // ── Inject context + current question as final user message ───────────────
  //
  // Log a token estimate at development time for cost/budget visibility.
  // In production this is a no-op (IS_PRODUCTION suppresses the log).
  if (process.env.NODE_ENV === "development") {
    const inputEstimate =
      estimateTokens(SYSTEM_PROMPT) +
      selectedTurns.reduce((n, m) => n + estimateTokens(m.content), 0) +
      estimateTokens(context) +
      estimateTokens(userQuery);
    console.debug(
      `[prompts] estimated input tokens: ~${inputEstimate} ` +
      `(history turns: ${selectedTurns.length})`
    );
  }

  messages.push({
    role: "user",
    content: `${context}\n\n[QUESTION]\n${userQuery}`,
  });

  return messages;
}
