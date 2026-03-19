/**
 * lib/security/guardrails.ts — Layer 1 pre-flight guardrail check.
 *
 * Runs on every sanitized message BEFORE any LLM call (~0 ms, pure regex).
 * Layer 2 enforcement lives in lib/openai/systemPrompt.ts and fires on every
 * completion call regardless of whether Layer 1 passed.
 *
 * Defence-in-depth strategy
 * ──────────────────────────
 *  Layer 0 — sanitize.ts        : structure (length, encoding, BiDi)
 *  Layer 1 — this file          : intent (patterns checked here)
 *  Layer 2 — systemPrompt.ts    : model-level rules baked into every call
 *  Layer 3 — outputGuard.ts     : post-generation output validation
 *
 * Pattern categories (checked in priority order)
 * ────────────────────────────────────────────────
 *  system-prompt  — requests to reveal or acknowledge hidden instructions
 *  injection      — prompt override / jailbreak / role-play / encoding attacks
 *  action         — requests to submit, approve, send, or modify anything
 *  pii            — requests for other employees' personal information
 *
 * Blocked messages:  GuardrailResult { allowed: false, reason, category }
 * Allowed messages:  GuardrailResult { allowed: true }
 *
 * Logging: only the category and message length are logged — never the
 * message text — to avoid PII appearing in server logs.
 *
 * Refusal strings are imported from lib/openai/systemPrompt.ts so that
 * Layer 1 and Layer 2 always surface identical wording to the user.
 */

import { REFUSAL_MESSAGES } from "@/lib/openai/systemPrompt";
import type { GuardrailResult } from "@/types";

// ── Pattern library ───────────────────────────────────────────────────────────
//
// Design rules for patterns:
//   • Prefer word boundaries (\b) to reduce false positives on substrings.
//   • Anchor to sentence start (^) only when the phrase is only suspicious at
//     the beginning of a message (e.g. command-like imperatives).
//   • The "i" flag is always set — no mixed-case attacks.
//   • Order patterns within a set from most specific to most general so that
//     the first match in a set is always the strongest signal.

// ── Category 1: System-prompt disclosure ──────────────────────────────────────
// Requests to reveal, repeat, summarise, or acknowledge system instructions.
// Separated from general injection so telemetry can distinguish curiosity
// (disclosure) from active manipulation (injection).

const SYSTEM_PROMPT_PATTERNS: RegExp[] = [
  // Direct "system prompt" mention (original)
  /\bsystem\s+prompt\b/i,

  // "reveal / show / print / display / repeat / output your instructions/rules/prompt"
  /\b(reveal|show|print|display|repeat|output|tell me|share|give me|expose)\b.{0,30}\b(instructions?|prompt|rules|directives?|guidelines?|system\s+message|initial\s+message|configuration)\b/i,

  // "what are / what were / what is your instructions / rules / prompt"
  /\bwhat\s+(are|were|is)\s+(your|the)\s+(instructions?|rules?|prompt|directives?|guidelines?|system\s+message)\b/i,

  // "ignore that" / "forget your" / "disregard your" rules/instructions
  /\b(ignore|forget|disregard|bypass|override)\s+(that|your|all|those|these|previous|prior|the)\s+(instructions?|rules?|prompt|guidelines?|constraints?|context)\b/i,

  // "your hidden / your secret instructions/prompt"
  /\byour\s+(hidden|secret|actual|real|true|underlying)\s+(instructions?|prompt|rules?|purpose|goal|objective)\b/i,

  // "what context were you given" / "what context do you have"
  /\bwhat\s+context\s+(were\s+you\s+given|do\s+you\s+have|are\s+you\s+using)\b/i,

  // "print everything above" / "repeat everything before this"
  /\b(print|repeat|output|show)\s+(everything|all\s+text|the\s+text)\s+(above|before|prior|preceding)\b/i,
];

// ── Category 2: Prompt injection and jailbreak ────────────────────────────────
// Attempts to override model instructions, adopt a different persona,
// or escape the chatbot's operational boundaries.

const INJECTION_PATTERNS: RegExp[] = [
  // Classic override phrases (original — kept for coverage)
  /ignore\s+(previous|all|prior|your)\s+instructions/i,
  /disregard\s+(your\s+)?(rules|guidelines|instructions|constraints)/i,

  // Persona / role-play manipulation
  /pretend\s+(you\s+are|to\s+be|that\s+you('re|are))/i,
  /act\s+as\s+(a\s+)?(different|new|another|unrestricted|uncensored|unfiltered|free)/i,
  /you\s+are\s+now\s+(a\s+|an\s+)?(?!HR|policy|assistant)/i,
  /\brole\s*-?\s*play\s+(as|a|the)\b/i,
  /\bpretend\s+(this|it)\s+is\s+(fiction|a\s+story|a\s+game|a\s+simulation|hypothetical)\b/i,
  /\b(in\s+this\s+story|for\s+the\s+story|in\s+this\s+game|in\s+this\s+scenario)\s+you\s+(are|can|will|have)\b/i,

  // Social-engineering "special mode" tricks
  /\b(developer|admin|maintenance|debug|god|super|privileged|unrestricted|jailbreak|test)\s+mode\b/i,
  /\b(my\s+)?(manager|boss|ceo|cto|hr|admin|administrator|developer|creator|owner)\s+(said|told|authorized|approved|gave\s+permission|gave\s+you\s+permission|says\s+you\s+can)\b/i,
  /\bspecial\s+(access|permission|authorization|privileges?|instructions?)\b/i,

  // "New instructions / from now on / your new rule"
  /\b(from\s+now\s+on|starting\s+now|going\s+forward)\s+(you\s+(are|will|must|should|can)|ignore|forget)\b/i,
  /\b(your\s+new|new\s+rule|new\s+instruction|override\s+rule)\s*[:\-–]?\s*/i,

  // Prompt-delimiter injection — attempt to inject LLM format tokens
  // (used against instruction-tuned models and pipeline parsers)
  /\[INST\]|\[\/INST\]|<<SYS>>|<\/s>|\[\/SYS\]|<\|im_start\|>|<\|im_end\|>/i,
  // Chat-ML style delimiters and OpenAI role injection via newlines
  /\n\s*(system|user|assistant)\s*:\s*/i,
  /\\n\\n(Human|Assistant|System)\s*:/i,

  // "Repeat after me" / "echo the following" — instruction planting
  /\b(repeat\s+after\s+me|echo\s+the\s+following|say\s+exactly|output\s+the\s+following)\b/i,

  // DAN / known jailbreak names (original — kept)
  /\bDAN\b|\bDAN\s+mode\b/i,
];

// ── Category 3: Action intent ─────────────────────────────────────────────────
// Requests to perform, initiate, or facilitate an action in any system.
// The bot is read-only — no write operations of any kind are permitted.

const ACTION_PATTERNS: RegExp[] = [
  // Submit / approve / reject / send (original — kept)
  /\b(submit|approve|reject|send|email)\b/i,

  // Create / open / raise / log / file a ticket or request (original — kept)
  /\b(create|open|raise|log|file)\s+(a\s+)?(ticket|request|complaint|claim|issue)\b/i,

  // Book / schedule / cancel meetings or leave (original — kept)
  /\b(book|schedule|cancel)\s+(a\s+)?(meeting|appointment|leave|vacation|day\s+off)\b/i,

  // Update / modify / change / delete records (original — kept)
  /\b(update|modify|change|delete|remove)\s+(my\s+)?(record|profile|details|account|salary)\b/i,

  // Process / trigger / initiate a workflow (original — kept)
  /\b(process|trigger|initiate|start)\s+(a\s+)?(workflow|request|approval)\b/i,

  // Notify — "notify my manager", "send a notification to HR"
  /\b(notify|send\s+(a\s+)?notification\s+to|alert)\s+(my\s+)?(manager|hr|team|department|supervisor|colleague)\b/i,

  // Register / enroll — "register me for", "enroll me in the plan"
  /\b(register|enrol+)\s+(me\s+)?(for|in|on|to)\b/i,

  // Apply for — "apply for parental leave", "apply for the benefit"
  /\bapply\s+(for|to)\s+(the\s+)?(leave|benefit|program|scheme|plan|policy|insurance|bonus)\b/i,

  // Claim — "claim my entitlement", "claim the benefit"
  /\bclaim\s+(my\s+)?(entitlement|benefit|allowance|reimbursement|bonus|pay)\b/i,

  // Fill out / complete a form
  /\b(fill\s+out|complete|sign)\s+(a\s+|the\s+)?(form|application|document)\b/i,

  // Add me to / put me in / enrol me
  /\b(add|put|place|enrol+|include)\s+me\s+(in|on|to|into)\s+(the\s+)?\w/i,
];

// ── Category 4: PII requests ───────────────────────────────────────────────────
// Requests for another employee's personal or confidential information.

const PII_PATTERNS: RegExp[] = [
  // "salary / pay / compensation of <name>" (original — kept)
  /\b(salary|pay|compensation)\s+(of|for)\s+\w+/i,

  // "performance review / appraisal of <name>" (original — kept)
  /\b(performance\s+review|appraisal)\s+(of|for)\s+\w+/i,

  // "personal / private / confidential information about <name>" (original — kept)
  /\b(personal|private|confidential)\s+(details?|information|data)\s+(of|about|for)\s+\w+/i,

  // "what does <name> earn / make / get paid" (original — kept)
  /\bwhat\s+does\s+\w+\s+(earn|make|get\s+paid)\b/i,

  // "show me [someone's] HR file / personnel record"
  /\b(show|get|access|see|view)\s+(me\s+)?\w+('s)?\s+(hr\s+file|personnel\s+record|employment\s+record|personal\s+file)\b/i,
];

// ── Ordered check definitions ─────────────────────────────────────────────────
//
// Evaluated in order — first match wins.
// system-prompt before injection so disclosure attempts get the right category.

import type { RefusalDefinition } from "@/types";

const GUARDRAIL_DEFINITIONS: RefusalDefinition[] = [
  {
    category: "system-prompt",
    patterns: SYSTEM_PROMPT_PATTERNS,
    reason:   REFUSAL_MESSAGES.injection,  // same user-facing string — no category leak
  },
  {
    category: "injection",
    patterns: INJECTION_PATTERNS,
    reason:   REFUSAL_MESSAGES.injection,
  },
  {
    category: "action",
    patterns: ACTION_PATTERNS,
    reason:   REFUSAL_MESSAGES.action,
  },
  {
    category: "pii",
    patterns: PII_PATTERNS,
    reason:   REFUSAL_MESSAGES.pii,
  },
];

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Runs all guardrail checks on a sanitized user message.
 *
 * @param message - Sanitized user input (output of sanitizeInput())
 * @returns         { allowed: true } or { allowed: false, reason, category }
 */
export function checkGuardrails(message: string): GuardrailResult {
  for (const def of GUARDRAIL_DEFINITIONS) {
    if (def.patterns.some((p) => p.test(message))) {
      console.warn(
        `[guardrails] Blocked. Category: ${def.category}. Message length: ${message.length}`
      );
      return { allowed: false, reason: def.reason, category: def.category };
    }
  }
  return { allowed: true };
}
