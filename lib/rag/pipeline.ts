/**
 * lib/rag/pipeline.ts — retrieval pipeline for the HR policy chatbot.
 *
 * This is the single entry point that app/api/chat/route.ts calls to go from
 * a raw user question to everything needed to build a grounded LLM response.
 *
 * Exported functions (in order of use):
 * ─────────────────────────────────────
 * retrieveRelevantChunks(question, options?)
 *   Embeds the question and retrieves the most similar policy chunks.
 *   Returns a RetrievalResult that includes the chunks AND a `hasContext` flag
 *   so the route can handle the "no matching policy" case before calling the LLM.
 *
 * formatContextForPrompt(chunks)
 *   Formats the retrieved chunks into a structured [POLICY CONTEXT] block that
 *   is injected into the LLM's user message.  The format is optimised for
 *   GPT-4o-mini: numbered excerpts, explicit source attribution, clear
 *   instructions that the model must answer only from these excerpts.
 *
 * buildCitationObjects(chunks)
 *   Converts RetrievedChunk[] into the Citation[] that is sent to the frontend
 *   alongside the streamed answer.  Deduplicates by (sourceFile, section) and
 *   truncates chunk text to a short readable excerpt.
 *
 * Guardrail: answers from retrieved content only
 * ─────────────────────────────────────────────
 * When retrieveRelevantChunks returns hasContext: false (no chunks above the
 * minimum score threshold), the route MUST NOT call the LLM.  Instead it
 * returns the standard "no policy found" message.  This is enforced by design:
 * the route receives hasContext and branches before LLM invocation.
 *
 * Dependency chain:
 *   pipeline.ts
 *     → lib/rag/embeddings.ts   (embedQuery)
 *     → lib/rag/vectorStore.ts  (initVectorStore)
 *     → lib/rag/retriever.ts    (retrieveChunks)
 *     → lib/utils/citations.ts  (formatCitations)
 */

import { embedQuery, embedBatch } from "./embeddings";
import { initVectorStore }        from "./vectorStore";
import { retrieveChunks, type RetrieveOptions } from "./retriever";
import { expandQuery }            from "./queryExpander";
import { formatCitations }        from "@/lib/utils/citations";
import { env }                    from "@/lib/config/env";

import type { RetrievedChunk, Citation } from "@/types";

// ── Retrieval constants ────────────────────────────────────────────────────────

/**
 * Minimum chunks from the primary pass before we attempt the fallback pass.
 * If primary retrieval returns fewer than this many chunks, a second pass runs
 * with a lower similarity threshold to catch relevant-but-lower-scoring chunks.
 */
const FALLBACK_TRIGGER_COUNT = 2;

/**
 * Similarity threshold used in the fallback pass.
 * Deliberately lower than RAG_MIN_SCORE to cast a wider net when the primary
 * pass finds little or nothing.
 */
const FALLBACK_MIN_SCORE = 0.25;

// ── Result types ───────────────────────────────────────────────────────────────

export interface RetrievalResult {
  /** Ordered chunks (score descending). Empty when hasContext is false. */
  chunks: RetrievedChunk[];
  /**
   * True if at least one chunk exceeded the minimum similarity threshold.
   * When false, the route must NOT call the LLM — it should return the
   * standard "no policy found" message to prevent hallucination.
   */
  hasContext: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Retrieves the most relevant policy chunks for a question using multi-query
 * retrieval with an automatic fallback pass.
 *
 * Strategy (3 layers):
 *
 *   Layer 1 — Multi-query primary retrieval
 *     Expands the question into up to 3 semantic variants (original + formal
 *     rewrite + concept-broadened version).  All variants are embedded in a
 *     single batch call, then each embedding drives an independent retrieval
 *     pass.  Results are merged and deduplicated by chunk ID.  This dramatically
 *     improves recall for questions phrased in casual or indirect language.
 *
 *   Layer 2 — Fallback pass (low-threshold)
 *     If the primary pass returns fewer than FALLBACK_TRIGGER_COUNT chunks,
 *     a second pass runs with a lower similarity threshold (FALLBACK_MIN_SCORE)
 *     using the original question embedding.  This catches relevant-but-lower-
 *     scoring chunks that were blocked by the primary threshold.
 *
 *   Layer 3 — Merged, deduplicated, re-ranked result
 *     All chunks from all passes are merged, deduplicated by chunk ID,
 *     re-sorted by score descending, and capped at topK.
 *
 * @param question  The user's retrieval query (rewritten if follow-up).
 * @param options   Optional overrides for topK, minScore, maxPerDoc.
 */
export async function retrieveRelevantChunks(
  question: string,
  options?: RetrieveOptions & { topK?: number }
): Promise<RetrievalResult> {
  // Ensure the vector store is loaded (idempotent after first call).
  await initVectorStore();

  const topK     = options?.topK ?? env.RAG_TOP_K;
  const minScore = options?.minScore ?? env.RAG_MIN_SCORE;

  // ── Layer 1: Multi-query primary retrieval ─────────────────────────────────

  // Expand the question into semantic variants (1–3 strings).
  const queryVariants = expandQuery(question);

  // Embed all variants in one batch call (one round-trip to OpenAI).
  const embeddings = queryVariants.length === 1
    ? [await embedQuery(queryVariants[0])]
    : await embedBatch(queryVariants);

  // Run a retrieval pass per embedding, collect all chunks.
  const allChunks: RetrievedChunk[] = [];
  for (const embedding of embeddings) {
    const passChunks = retrieveChunks(embedding, topK, { ...options, minScore });
    allChunks.push(...passChunks);
  }

  // Deduplicate by chunk ID, keeping the highest score for each.
  let merged = deduplicateChunks(allChunks);

  // ── Layer 2: Fallback pass if primary found very little ────────────────────

  if (merged.length < FALLBACK_TRIGGER_COUNT) {
    // Use the original question embedding (first in the batch) for the fallback.
    const fallbackEmbedding = embeddings[0];
    const fallbackChunks = retrieveChunks(
      fallbackEmbedding,
      topK,
      { ...options, minScore: FALLBACK_MIN_SCORE }
    );

    if (fallbackChunks.length > 0) {
      merged = deduplicateChunks([...merged, ...fallbackChunks]);
    }
  }

  // ── Layer 3: Re-rank and cap ───────────────────────────────────────────────

  // Sort by score descending and cap at topK.
  const chunks = merged
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    chunks,
    hasContext: chunks.length > 0,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Merges an array of possibly-duplicate chunks, keeping the highest score
 * for each unique chunk (identified by sourceFile + text content hash).
 *
 * Using text slice as the dedup key avoids needing a separate chunk ID field
 * while being robust to any chunk ordering.
 */
function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Map<string, RetrievedChunk>();

  for (const chunk of chunks) {
    // Key on source file + first 80 chars of text — fast and collision-resistant
    // for the corpus sizes used here (715 chunks, avg ~1 500 chars each).
    const key = `${chunk.metadata.sourceFile}::${chunk.text.slice(0, 80)}`;
    const existing = seen.get(key);
    if (!existing || chunk.score > existing.score) {
      seen.set(key, chunk);
    }
  }

  return Array.from(seen.values());
}

/**
 * Formats retrieved chunks into a structured context block for the LLM.
 *
 * The block is designed to:
 *   1. Be unambiguous about the source of each excerpt.
 *   2. Explicitly instruct the model to answer only from the excerpts.
 *   3. Include all metadata that helps the model attribute its answer
 *      (policy title, section, page number, category).
 *
 * When no chunks are provided, returns a context block that tells the model
 * explicitly that no relevant policy was found — ensuring the model can
 * produce a correct "I don't know" response rather than hallucinating.
 *
 * @param chunks — RetrievedChunk[] from retrieveRelevantChunks().
 */
export function formatContextForPrompt(chunks: RetrievedChunk[]): string {
  const header =
    "[POLICY CONTEXT]\n" +
    "The following excerpts are from official HR policy documents.\n" +
    "Base your answer on these excerpts. You may:\n" +
    "  - Quote or paraphrase text from the excerpts as confirmed policy facts\n" +
    "  - Apply the rules logically to the user's specific scenario\n" +
    "  - Synthesise information across multiple excerpts into a single answer\n" +
    "  - Draw logical conclusions from stated rules (inference from facts is allowed)\n" +
    "You must NOT state facts, numbers, or entitlements not present in these excerpts.";

  if (chunks.length === 0) {
    return (
      header +
      "\n\nNo relevant policy documents were found for this question.\n" +
      "You MUST respond: \"I couldn't find information about that in the " +
      "current policy documents. Please contact HR directly for assistance.\""
    );
  }

  const excerpts = chunks
    .map((chunk, i) => formatSingleExcerpt(chunk, i + 1, chunks.length))
    .join("\n\n");

  return `${header}\n\n${excerpts}`;
}

/**
 * Converts retrieved chunks into Citation objects for the API response.
 *
 * Citations are sent to the frontend in the metadata chunk alongside every
 * assistant turn.  They are rendered as collapsible source cards so users
 * can verify every answer against the original policy document.
 *
 * Deduplicates by (sourceFile, section): if two overlapping windows from the
 * same section were retrieved, only the higher-scoring one is shown.
 *
 * @param chunks — RetrievedChunk[] from retrieveRelevantChunks().
 */
export function buildCitationObjects(chunks: RetrievedChunk[]): Citation[] {
  // Delegate to the shared citation formatter which handles deduplication
  // and excerpt truncation.
  return formatCitations(chunks);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Formats a single chunk into a numbered excerpt block for the LLM context.
 *
 * Example output:
 *   ── Excerpt 2 of 5 ──────────────────────────
 *   Document:  VACATION LEAVE POLICY
 *   Section:   I. Vacation Leave
 *   File:      Vacation-Policy-2023-11-15.pdf  |  Page 1  |  Leave & Benefits
 *
 *   I. Vacation Leave
 *
 *   A. All regular full-time City officers or employees, including…
 */
function formatSingleExcerpt(
  chunk: RetrievedChunk,
  index: number,
  total: number
): string {
  const { metadata, text } = chunk;

  // Build the source header line
  const fileInfo = [
    metadata.sourceFile,
    metadata.pageOrLine != null ? `Page ${metadata.pageOrLine}` : null,
    metadata.policyCategory ?? null,
  ]
    .filter(Boolean)
    .join("  |  ");

  const lines: string[] = [
    `── Excerpt ${index} of ${total} ${"─".repeat(Math.max(0, 44 - String(index).length - String(total).length))}`,
    `Document:  ${metadata.policyTitle}`,
  ];

  if (metadata.section && metadata.section !== metadata.policyTitle) {
    lines.push(`Section:   ${metadata.section}`);
  }

  lines.push(`File:      ${fileInfo}`);
  lines.push("");           // blank line before body
  lines.push(text.trim());  // the actual chunk text

  return lines.join("\n");
}
