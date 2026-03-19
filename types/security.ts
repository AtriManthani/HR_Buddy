/**
 * types/security.ts — guardrail and refusal types.
 *
 * Used by:
 *   lib/security/guardrails.ts  — produces GuardrailResult
 *   app/api/chat/route.ts       — consumes GuardrailResult, calls streamRefusal
 */

// ── Guardrail result ───────────────────────────────────────────────────────────

/**
 * The broad category of a blocked request.
 *
 *   "system-prompt" — attempt to reveal, repeat, or acknowledge system instructions
 *   "injection"     — prompt override / jailbreak / role-play / encoding attack
 *   "action"        — request to perform an action (submit, approve, notify…)
 *   "pii"           — request for another employee's personal information
 */
export type RefusalCategory = "system-prompt" | "injection" | "action" | "pii";

/**
 * Result of the regex-based guardrail pre-check (Layer 1 enforcement).
 *
 * Returned by checkGuardrails() in lib/security/guardrails.ts.
 * When allowed is false, reason is guaranteed to be present.
 */
export type GuardrailResult =
  | { allowed: true }
  | { allowed: false; reason: string; category: RefusalCategory };

/**
 * Internal shape used within guardrails.ts to associate each pattern category
 * with its human-readable refusal message before the result is returned.
 */
export interface RefusalDefinition {
  category: RefusalCategory;
  patterns: RegExp[];
  reason: string;
}
