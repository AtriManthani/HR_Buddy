/**
 * types/citations.ts — citation and recommendation shapes.
 *
 * These types flow from the API (built from RetrievedChunk data) to the
 * frontend, where they are rendered in AssistantResponse and CitationCard.
 * They contain no embedding vectors and no raw chunk text — only the
 * human-readable fields needed for display.
 */

// ── Citation ───────────────────────────────────────────────────────────────────

/**
 * A source reference returned to the frontend alongside every answer.
 *
 * Built from RetrievedChunk in app/api/chat/route.ts (buildCitations).
 * Rendered as collapsible cards by components/chat/CitationCard.tsx.
 */
export interface Citation {
  /** Chunk ID — matches PolicyChunk.id in the vector store */
  id: string;
  /** Human-readable policy name (e.g. "Annual Leave Policy") */
  policyTitle: string;
  /** Original filename inside data/raw/ (e.g. "Vacation-Policy-2023-11-15.pdf") */
  sourceFile: string;
  /** Section heading from the source document, if parseable */
  section?: string;
  /** 1-based page number (PDF) or line number (plain-text) */
  pageOrLine?: number;
  /**
   * High-level policy category inferred at ingest time from the filename.
   * "Leave & Benefits" | "Workplace Safety" | "Ethics & Compliance" | "General HR Policy"
   * Used by CitationCard to give navigational context above the excerpt.
   */
  policyCategory?: string;
  /** Short excerpt from the matched chunk (≤ 300 chars, word-boundary truncated) */
  excerpt: string;
  /** Cosine similarity score (0.0–1.0) — shown in dev mode for debugging */
  score: number;
}

// ── Recommendation ────────────────────────────────────────────────────────────

/**
 * The nature of the recommendation — drives icon selection in the frontend.
 *
 *   eligibility    — user should verify whether they qualify (e.g. service length, role)
 *   documentation  — a form or supporting document is likely required
 *   cross-policy   — the topic touches multiple policy areas; an HR rep can help
 *   complexity     — the policy has many conditions or steps; professional guidance helps
 *   low-confidence — the retrieved content may not fully cover the user's situation
 */
export type RecommendationType =
  | "eligibility"
  | "documentation"
  | "cross-policy"
  | "complexity"
  | "low-confidence";

/**
 * An optional contextual recommendation banner attached to complex answers.
 *
 * Always informational — never triggers actions, approvals, or form submissions.
 * Rendered as a highlighted callout below the main answer card.
 * Multiple recommendations may be returned; each is rendered as its own banner.
 */
export interface Recommendation {
  /** Semantic type — used to select icon and aria-label in the frontend */
  type: RecommendationType;
  /** Short headline shown in the banner (e.g. "Check eligibility criteria") */
  headline: string;
  /** Supporting detail — plain prose, no markdown */
  detail: string;
}

// ── Related policy ────────────────────────────────────────────────────────────

/**
 * A navigational reference to a related but not directly cited policy.
 *
 * Displayed as pill links below the answer.
 * Purely informational: no deep links, no ticket triggers, no form pre-fill.
 */
export interface RelatedPolicy {
  /** Human-readable policy name (e.g. "Parental Leave Policy") */
  title: string;
  /** Broad category — matches sidebar category labels in Sidebar.tsx */
  category: string;
}
