/**
 * lib/chat/chatApi.ts — API transport layer for the chat feature.
 *
 * Exports a single async generator: sendMessage()
 * It yields StreamChunk objects that the useChatState hook consumes.
 *
 * ── CURRENT STATE (Phase 3 — frontend state management) ──────────────────────
 * This is a STUB implementation. It simulates the full streaming protocol
 * locally with realistic timing — no fetch, no OpenAI calls.
 *
 * The stub lets the entire UI (loading state, token streaming, structured
 * sections, citations, recommendations) be developed and tested without a
 * live backend.
 *
 * ── PHASE 4 MIGRATION ────────────────────────────────────────────────────────
 * Replace the body of sendMessage() with a real fetch to POST /api/chat.
 * Parse the NDJSON ReadableStream and yield the same StreamChunk types.
 * The useChatState hook and all UI components need zero changes.
 *
 * Public contract (must be preserved across phases):
 *   sendMessage(message, sessionId) → AsyncGenerator<StreamChunk>
 */

import type { StreamChunk, Citation, StructuredResponse } from "@/types";

// ── Stub helpers ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Split a string into small token-sized pieces, preserving spaces. */
function tokenize(text: string): string[] {
  // Split on word boundaries + punctuation to mimic real LLM token output
  return text.match(/\S+\s*/g) ?? [];
}

// ── Stub response corpus ──────────────────────────────────────────────────────

interface StubResponse {
  answer: string;
  explanation?: string;
  relatedPolicies?: { title: string; category: string }[];
}

const STUB_RESPONSES: StubResponse[] = [
  {
    answer:
      "According to the Annual Leave Policy, all permanent employees are entitled to a minimum of 20 working days of paid annual leave per calendar year. This entitlement is pro-rated for employees who join mid-year or work part-time hours.",
    explanation:
      "Leave entitlement accrues from the employee's start date and resets on the 1st of January each year. Up to 5 unused days may be carried over to the following year, subject to line manager approval. Leave must be requested and approved in advance through the HR system.",
    relatedPolicies: [
      { title: "Sick Leave Policy",       category: "Leave & Time Off" },
      { title: "Public Holidays Policy",  category: "Leave & Time Off" },
      { title: "Flexible Working Policy", category: "Remote Work"      },
    ],
  },
  {
    answer:
      "The Sick Leave Policy entitles employees to up to 10 days of paid sick leave per calendar year. A medical certificate is required for absences exceeding 3 consecutive working days.",
    explanation:
      "Sick leave is separate from annual leave and cannot be used interchangeably. Employees should notify their line manager before the start of their working day if they are unable to attend. Repeated short-term absences may trigger a welfare meeting with HR.",
    relatedPolicies: [
      { title: "Annual Leave Policy",           category: "Leave & Time Off"  },
      { title: "Employee Assistance Programme", category: "Health & Benefits" },
    ],
  },
  {
    answer:
      "The Remote Work Policy allows eligible employees to work from home up to 3 days per week, subject to role requirements and manager approval. Employees must maintain a suitable, secure work environment.",
    explanation:
      "Eligibility is assessed based on job function, performance record, and operational requirements. Employees are expected to be reachable during core hours (10:00–16:00) and must attend the office on required collaboration days. Equipment provision and data security obligations remain in force when working remotely.",
    relatedPolicies: [
      { title: "IT Security Policy",      category: "Workplace Safety" },
      { title: "Flexible Working Policy", category: "Remote Work"      },
    ],
  },
  {
    answer:
      "The Performance Review process runs twice per year — a mid-year check-in in June and a full annual review in December. Ratings are calibrated by the HR team before final scores are confirmed.",
    explanation:
      "Employees complete a self-assessment ahead of each review, which forms the basis for a structured conversation with their line manager. Ratings feed into the compensation review cycle that follows in Q1 each year. Development plans agreed during the review are tracked quarterly.",
    relatedPolicies: [
      { title: "Compensation Policy",    category: "Compensation & Pay" },
      { title: "Learning & Development", category: "Learning"           },
    ],
  },
];

const STUB_CITATIONS: Citation[] = [
  {
    id:          "stub-cite-1",
    policyTitle: "Employee Policy Handbook",
    sourceFile:  "employee-handbook.md",
    section:     "Core Entitlements",
    pageOrLine:  4,
    excerpt:
      "All permanent employees who have completed their probationary period are entitled to the full range of benefits and protections described in this handbook, subject to the terms of their individual contract of employment.",
    score: 0.93,
  },
  {
    id:          "stub-cite-2",
    policyTitle: "HR Framework Document",
    sourceFile:  "hr-framework.md",
    section:     "General Provisions",
    pageOrLine:  2,
    excerpt:
      "Company policies apply to all individuals engaged under a contract of employment with the organisation, and are reviewed annually by the People & Culture team to ensure alignment with current legislation.",
    score: 0.87,
  },
  {
    id:          "stub-cite-3",
    policyTitle: "People Operations Guidelines",
    sourceFile:  "people-ops-guidelines.md",
    section:     "Policy Scope",
    pageOrLine:  1,
    excerpt:
      "These guidelines supplement the Employee Handbook and set out the operational procedures for managing leave, performance, and workplace conduct across all offices.",
    score: 0.81,
  },
];

/** Pick a stub response based on keyword matching against the question. */
function pickResponse(message: string): StubResponse {
  const lower = message.toLowerCase();
  if (lower.includes("sick") || lower.includes("illness") || lower.includes("medical")) {
    return STUB_RESPONSES[1];
  }
  if (lower.includes("remote") || lower.includes("home") || lower.includes("hybrid")) {
    return STUB_RESPONSES[2];
  }
  if (lower.includes("performance") || lower.includes("review") || lower.includes("appraisal")) {
    return STUB_RESPONSES[3];
  }
  return STUB_RESPONSES[0]; // default: annual leave
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends a user message and yields a stream of StreamChunk events.
 *
 * In this stub implementation:
 *   1. Waits 450–650ms to simulate server processing
 *   2. Streams answer + explanation tokens at 25–45ms intervals
 *   3. Yields a final metadata chunk with citations and structured response
 *
 * @param message   - The user's question text
 * @param sessionId - Existing session ID, or null for a new session
 */
export async function* sendMessage(
  message:   string,
  sessionId: string | null
): AsyncGenerator<StreamChunk> {
  // Simulate network + server processing latency
  await sleep(450 + Math.random() * 200);

  const response   = pickResponse(message);
  const newSession = sessionId ?? crypto.randomUUID();

  // Build the full text to stream (answer, then optional explanation)
  const fullText = response.explanation
    ? `${response.answer}\n\n${response.explanation}`
    : response.answer;

  // Stream tokens
  const tokens = tokenize(fullText);
  for (const token of tokens) {
    await sleep(25 + Math.random() * 20);
    yield { type: "token", token } satisfies StreamChunk;
  }

  // Final metadata chunk
  yield {
    type:      "metadata",
    sessionId: newSession,
    citations:       STUB_CITATIONS,
    recommendations: [],
    structuredResponse: {
      answer:          response.answer,
      explanation:     response.explanation,
      relatedPolicies: response.relatedPolicies,
    },
  } satisfies StreamChunk;
}
