/**
 * lib/rag/embedding/EmbeddingProvider.ts
 *
 * The canonical interface for all embedding implementations in this project.
 *
 * Why a provider abstraction?
 * ───────────────────────────
 * The pipeline is currently backed by OpenAI text-embedding-3-small, which is
 * the right choice for production: cheap, fast, and high quality.  But there
 * are contexts where you might want to swap it out without rewriting call sites:
 *
 *   - Local development / CI  : avoid spending API quota on test runs by using
 *                               LocalHashEmbeddingProvider (deterministic, free).
 *   - Compliance / air-gapped : run a local sentence-transformer model via
 *                               a self-hosted API (just add a new provider).
 *   - Cost reduction          : migrate to a cheaper provider later with a
 *                               one-line env change.
 *
 * All providers share this interface.  Consumers — embeddings.ts,
 * scripts/ingest.ts, retriever.ts — depend on the interface, not the
 * concrete class.  Adding a new provider means implementing this interface
 * and registering it in registry.ts.
 *
 * Contract
 * ────────
 * 1. `dimensions` is fixed for the lifetime of a provider instance and must
 *    match the dimensionality of every vector it produces.  Changing the
 *    value between ingest runs requires a full re-ingest because stored vectors
 *    and query vectors must live in the same space.
 *
 * 2. `embedMany` MUST return vectors in the same order as the input `texts`
 *    array.  Callers rely on index alignment.
 *
 * 3. Both methods are `async` so network-backed providers (OpenAI, etc.) and
 *    blocking local implementations (WASM model inference) fit the same shape.
 */

// ── Provider interface ─────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  /**
   * Short identifier used in logs and error messages.
   * Examples: "openai/text-embedding-3-small", "local/hash"
   */
  readonly name: string;

  /**
   * Dimensionality of every vector this provider produces.
   * Must match the dimensionality of vectors stored in data/index.json.
   */
  readonly dimensions: number;

  /**
   * Embed a single text string.
   * Convenience wrapper; prefer embedMany() when processing more than one text.
   */
  embedOne(text: string): Promise<number[]>;

  /**
   * Embed an array of texts and return their vectors in the same order.
   * Implementations are responsible for batching, retry, and rate-limit
   * handling internally — callers just await the result.
   */
  embedMany(texts: string[]): Promise<number[][]>;
}

// ── Shared result type ─────────────────────────────────────────────────────────

/**
 * A single embedding result, associating the original text with its vector.
 * Returned by higher-level helpers in index.ts; not required by the interface
 * itself (which only returns number[]).
 */
export interface EmbeddingResult {
  text: string;
  vector: number[];
}

// ── Provider metadata ──────────────────────────────────────────────────────────

/**
 * Human-readable descriptor attached to IngestRecord (data/index.json) so
 * the stored index is self-describing.  Helps diagnose dimension mismatches
 * when switching providers.
 */
export interface ProviderInfo {
  /** e.g. "openai" | "local" */
  provider: string;
  /** e.g. "text-embedding-3-small" */
  model: string;
  /** Vector dimensionality */
  dimensions: number;
}
