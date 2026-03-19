/**
 * lib/rag/embeddings.ts — public embedding facade.
 *
 * Provides the two call-site functions the rest of the codebase uses:
 *   embedQuery(text)     → number[]    (one vector, used at query time)
 *   embedBatch(texts)    → number[][]  (many vectors, used at ingest time)
 *
 * These functions are thin wrappers over the active EmbeddingProvider.
 * They exist so that callers — app/api/chat/route.ts and scripts/ingest.ts —
 * never need to import from lib/rag/embedding/registry directly.  Switching
 * the active provider (via EMBEDDING_PROVIDER env var) is transparent to all
 * callers.
 *
 * Provider dispatch
 * ─────────────────
 * EMBEDDING_PROVIDER=openai  (default) → OpenAIEmbeddingProvider
 *   Calls OpenAI text-embedding-3-small.  Requires OPENAI_API_KEY.
 *   1 536-dimensional vectors.
 *
 * EMBEDDING_PROVIDER=local             → LocalHashEmbeddingProvider
 *   Deterministic bag-of-words projection.  No API key required.
 *   Same 1 536-d shape — useful for local dev and CI.
 *   Vectors are NOT semantically meaningful; retrieval quality is lower.
 *
 * See lib/rag/embedding/registry.ts to add further providers.
 *
 * Batching note (ingest)
 * ──────────────────────
 * scripts/ingest.ts splits the corpus into batches of 100 chunks before
 * calling embedBatch().  The provider itself handles internal retry logic,
 * so the script does not need to implement retries.
 */

import { getEmbeddingProvider } from "./embedding/registry";

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Embeds a single text string and returns its vector.
 * Used at query time (one call per user message in the chat route).
 */
export async function embedQuery(text: string): Promise<number[]> {
  return getEmbeddingProvider().embedOne(text.trim());
}

/**
 * Embeds an array of texts and returns their vectors in input order.
 *
 * Callers should split very large arrays into batches of ≤ 100 items before
 * calling this function — not because embedBatch itself has a hard limit, but
 * because smaller batches give the provider better retry granularity on errors.
 *
 * @param texts — Texts to embed.  Must be non-empty.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  return getEmbeddingProvider().embedMany(texts);
}

/**
 * Returns the dimensionality of the active provider's vectors.
 * Exposed so callers (e.g. vectorStore validation) can read the correct
 * expected dimensions without importing the registry directly.
 */
export function embeddingDimensions(): number {
  return getEmbeddingProvider().dimensions;
}

/**
 * Returns the active provider's name string, e.g. "openai/text-embedding-3-small".
 * Useful for logging and for stamping IngestRecord with provenance metadata.
 */
export function embeddingProviderName(): string {
  return getEmbeddingProvider().name;
}
