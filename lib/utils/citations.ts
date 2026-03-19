/**
 * lib/utils/citations.ts — converts RetrievedChunk[] into Citation[] for the API.
 *
 * Citations are the primary trust mechanism of this chatbot.  Every response
 * that draws on policy content MUST include at least one citation so the user
 * can verify the answer against the source document.
 *
 * Responsibilities:
 *   - Map each RetrievedChunk to a Citation using its metadata.
 *   - Validate required fields: reject citations with empty policyTitle,
 *     sourceFile, or excerpt — a broken citation is worse than none.
 *   - Trim chunk text to a short excerpt (≤ 300 chars) at a word boundary.
 *   - Deduplicate: if two chunks reference the same (sourceFile, section),
 *     keep only the one with the higher similarity score so the citation list
 *     does not show the same section twice.
 *   - Preserve the retrieval score and policyCategory for transparency.
 *
 * Anti-fabrication guarantee
 * ──────────────────────────
 * This module only ever reads fields from RetrievedChunk.metadata — it never
 * invents, interpolates, or infers metadata.  A citation can only contain
 * what the ingest pipeline recorded in the vector store.  If a field is absent
 * in the metadata, it is absent in the Citation and hidden in the UI.
 */

import type { RetrievedChunk, Citation } from "@/types";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum length of the excerpt shown in a CitationCard. */
const EXCERPT_MAX_LENGTH = 300;

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Returns true only if the citation has all required fields populated.
 *
 * Citations with a missing policyTitle or sourceFile give employees nothing
 * to verify against — they would appear as empty labels in the UI.  A citation
 * with an empty excerpt provides no supporting evidence.  We silently drop
 * these rather than showing a broken or misleading source card.
 *
 * Required: policyTitle (non-empty), sourceFile (non-empty), excerpt (non-empty).
 * Optional fields (section, pageOrLine, policyCategory) may be absent.
 */
function isValidCitation(
  policyTitle: string | undefined,
  sourceFile:  string | undefined,
  excerpt:     string
): boolean {
  return (
    typeof policyTitle === "string" && policyTitle.trim().length > 0 &&
    typeof sourceFile  === "string" && sourceFile.trim().length  > 0 &&
    excerpt.trim().length > 0
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Converts an array of score-sorted RetrievedChunks into Citation objects
 * suitable for serialisation to the client.
 *
 * Processing order:
 *   1. Build excerpt (strip page markers, truncate to word boundary).
 *   2. Validate required fields — skip the chunk if any are missing.
 *   3. Deduplicate by (sourceFile, section) — keep highest-scoring chunk.
 *   4. Populate all available metadata including policyCategory.
 *
 * The input order (score descending) is preserved in the output.
 * Deduplication retains the first occurrence, which is always the
 * highest-scoring chunk because the retriever already sorted by score.
 *
 * @param chunks — Top-k chunks from retrieveChunks(), score descending.
 */
export function formatCitations(chunks: RetrievedChunk[]): Citation[] {
  const seen    = new Set<string>();
  const results: Citation[] = [];

  for (const chunk of chunks) {
    const excerpt = truncateToExcerpt(chunk.text, EXCERPT_MAX_LENGTH);

    // ── Validity gate ────────────────────────────────────────────────────────
    // Drop chunks with incomplete metadata before they reach the client.
    // An invalid citation is worse than no citation — it shows empty labels
    // and gives the employee nothing to verify.
    if (!isValidCitation(chunk.metadata.policyTitle, chunk.metadata.sourceFile, excerpt)) {
      console.warn(
        `[citations] Dropping chunk ${chunk.id}: missing required metadata ` +
        `(policyTitle="${chunk.metadata.policyTitle}", sourceFile="${chunk.metadata.sourceFile}", ` +
        `excerpt length=${excerpt.length})`
      );
      continue;
    }

    // ── Deduplication ────────────────────────────────────────────────────────
    // Two overlapping windows from the same section produce near-identical
    // citations.  The dedup key combines file + section so the same section
    // from two different documents is NOT collapsed.
    const key = `${chunk.metadata.sourceFile}::${chunk.metadata.section ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      id:             chunk.id,
      policyTitle:    chunk.metadata.policyTitle,
      sourceFile:     chunk.metadata.sourceFile,
      section:        chunk.metadata.section,
      pageOrLine:     chunk.metadata.pageOrLine,
      policyCategory: chunk.metadata.policyCategory,
      excerpt,
      score:          chunk.score,
    });
  }

  return results;
}

/**
 * Truncates `text` to at most `maxLength` characters, ending at the last
 * complete word before the cutoff (never splits a word mid-character).
 *
 * Appends "…" when truncation occurs so the reader knows the excerpt is
 * not the full passage.
 *
 * Strips before truncating:
 *   - Page markers inserted by extract.ts ("--- PAGE N ---")
 *   - "Source: …" lines inserted by the model (should not appear in chunk
 *     text, but strip defensively in case of a pipeline edge case)
 *
 * Examples:
 *   truncateToExcerpt("Hello world", 5)  →  "Hello…"
 *   truncateToExcerpt("Hello", 10)       →  "Hello"    (no change, already short)
 */
export function truncateToExcerpt(
  text: string,
  maxLength: number = EXCERPT_MAX_LENGTH
): string {
  const cleaned = text
    // Strip page markers captured at chunk boundaries
    .replace(/^---\s+PAGE\s+\d+\s+---\s*/gm, "")
    // Strip any stray "Source: …" lines (defensive — should not appear in chunks)
    .replace(/^source:.*$/gim, "")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;

  // Snap back to the last whitespace at or before the cutoff.
  const cutoff   = cleaned.lastIndexOf(" ", maxLength);
  const boundary = cutoff > 0 ? cutoff : maxLength;

  return cleaned.slice(0, boundary).trimEnd() + "…";
}
