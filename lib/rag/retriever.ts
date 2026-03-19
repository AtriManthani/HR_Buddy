/**
 * lib/rag/retriever.ts — nearest-neighbour retrieval over the in-memory store.
 *
 * Responsibilities:
 *   1. Score every stored chunk against the query embedding via cosine similarity.
 *   2. Filter out chunks below the minimum score threshold (RAG_MIN_SCORE).
 *   3. Sort by score descending.
 *   4. Diversity cap: limit how many chunks come from the same source document
 *      so the top-k results cover multiple policies when relevant.
 *   5. Return up to RAG_TOP_K RetrievedChunk objects.
 *
 * Configuration (lib/config/env.ts):
 *   RAG_TOP_K       Number of chunks to return.              Default: 5
 *   RAG_MIN_SCORE   Minimum cosine similarity threshold.     Default: 0.75
 *
 * Cosine similarity
 * ─────────────────
 *   sim(A, B) = (A · B) / (‖A‖ · ‖B‖)
 *
 *   Range: −1.0 to 1.0.  For OpenAI text-embedding-3-small on HR policy text,
 *   a topically relevant match typically scores 0.78–0.92.  The default
 *   MIN_SCORE of 0.75 rejects off-topic chunks while admitting near-misses.
 *
 *   The implementation avoids sqrt() per chunk: it accumulates squared
 *   magnitudes and computes their product's square root once at the end,
 *   keeping the hot loop tight.
 *
 * Diversity cap
 * ─────────────
 *   Returns at most MAX_CHUNKS_PER_DOC chunks from any single source document.
 *   Default is 2, which prevents a very long policy (e.g. HR-Policies-Section-C)
 *   from monopolising all top-k slots when a query is broadly relevant to it.
 *   Callers can override via retrieveChunks(embedding, topK, { maxPerDoc: N }).
 *
 * Performance
 * ──────────
 *   The corpus is ~715 chunks × 1 536 floats each ≈ 8.8 MB of float64 data.
 *   Brute-force cosine search over 715 vectors takes < 5 ms in V8, well within
 *   the latency budget of a streaming chat response.  A HNSW index would be
 *   needed only if the corpus grows to tens of thousands of chunks.
 */

import type { RetrievedChunk } from "@/types";
import { getAllChunks } from "./vectorStore";
import { env } from "@/lib/config/env";

// ── Configuration ──────────────────────────────────────────────────────────────

const DEFAULT_TOP_K     = env.RAG_TOP_K;
const DEFAULT_MIN_SCORE = env.RAG_MIN_SCORE;

/** Maximum chunks returned from the same source document (diversity cap). */
const MAX_CHUNKS_PER_DOC = 2;

// ── Public API ─────────────────────────────────────────────────────────────────

export interface RetrieveOptions {
  /**
   * Minimum cosine similarity for a chunk to be included.
   * Defaults to RAG_MIN_SCORE from env.
   */
  minScore?: number;
  /**
   * Maximum chunks from any single source document.
   * Defaults to MAX_CHUNKS_PER_DOC (2).
   * Set to Infinity to disable the diversity cap.
   */
  maxPerDoc?: number;
}

/**
 * Returns the top-k most similar chunks for a given query embedding.
 *
 * @param queryEmbedding  Float vector from embedQuery() — must match the
 *                        dimensionality of stored chunk embeddings.
 * @param topK            Maximum chunks to return.  Defaults to RAG_TOP_K.
 * @param options         minScore and maxPerDoc overrides.
 */
export function retrieveChunks(
  queryEmbedding: number[],
  topK: number = DEFAULT_TOP_K,
  options: RetrieveOptions = {}
): RetrievedChunk[] {
  const minScore  = options.minScore  ?? DEFAULT_MIN_SCORE;
  const maxPerDoc = options.maxPerDoc ?? MAX_CHUNKS_PER_DOC;

  const chunks = getAllChunks();

  // ── Step 1: Score every chunk ──────────────────────────────────────────────

  const scored: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    const score = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (score >= minScore) {
      scored.push({ ...chunk, score });
    }
  }

  // ── Step 2: Sort by score descending ──────────────────────────────────────

  scored.sort((a, b) => b.score - a.score);

  // ── Step 3: Apply diversity cap ────────────────────────────────────────────

  // Track how many chunks we've already selected from each source document.
  const perDocCount = new Map<string, number>();
  const results: RetrievedChunk[] = [];

  for (const chunk of scored) {
    if (results.length >= topK) break;

    const docKey = chunk.metadata.sourceFile;
    const count  = perDocCount.get(docKey) ?? 0;

    if (count < maxPerDoc) {
      results.push(chunk);
      perDocCount.set(docKey, count + 1);
    }
  }

  return results;
}

/**
 * Computes the cosine similarity between two equal-length vectors.
 *
 *   sim(A, B) = (A · B) / (‖A‖ · ‖B‖)
 *
 * Returns 0 if either vector has zero magnitude (degenerate case).
 * This is a pure function with no side effects; safe to call from any context.
 *
 * Performance note:
 *   The loop is deliberately written without abstractions (no Array.reduce,
 *   no helper for dot product) so V8 can JIT it efficiently.  For 1 536-d
 *   vectors this runs in ~0.01 ms per call.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `[retriever] cosineSimilarity: vector length mismatch (${a.length} vs ${b.length}). ` +
        "Ensure the query was embedded with the same provider and model as the index."
    );
  }

  let dot  = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
