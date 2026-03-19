/**
 * lib/rag/embedding/LocalHashEmbeddingProvider.ts
 *
 * A deterministic, zero-dependency embedding provider for local development,
 * CI runs, and unit tests.
 *
 * How it works
 * ────────────
 * Produces a fixed-dimension (1 536-d by default) float vector from text using
 * a bag-of-words projection:
 *
 *   1. Tokenise the input: lowercase, strip punctuation, split on whitespace.
 *   2. For each token, compute two deterministic hash values (polynomial hash
 *      with different seeds) and use them as dimension indices.
 *   3. Increment those dimensions by 1.0 and 0.5 respectively, which
 *      distributes each token's "weight" across two independent dimensions —
 *      reducing hash collision effects compared to a single-hash approach.
 *   4. L2-normalise the resulting vector so cosine similarity is well-defined.
 *
 * Trade-offs vs OpenAI
 * ────────────────────
 *   ✓ Free, instant, works offline, fully deterministic — same text always
 *     produces the same vector in the same Node.js process.
 *   ✓ Shares overlap structure: two texts with many common tokens will have
 *     a measurably higher cosine similarity, so retrieval is not random.
 *   ✗ Not semantically aware — "vacation leave" and "annual time off" will
 *     score near 0 even though they are synonymous.
 *   ✗ Not suitable for production retrieval quality.
 *
 * When to use
 * ───────────
 *   Set EMBEDDING_PROVIDER=local to activate.  Useful for:
 *     • npm run ingest     — build the index without spending OpenAI quota
 *     • Unit / integration tests — deterministic, reproducible
 *     • Local development  — the chat UI will work; answers will be less accurate
 *
 * The dimensions constant matches OpenAI text-embedding-3-small (1 536) so
 * an index built with the local provider has the same schema as a production
 * one.  Switching back to OpenAI requires a full re-ingest because the vector
 * spaces are completely different.
 */

import type { EmbeddingProvider } from "./EmbeddingProvider";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Matches OpenAI text-embedding-3-small so the index.json schema is identical
 * regardless of provider.  Change both this constant and the OpenAI provider's
 * dimensions together if you ever switch models.
 */
const DIMENSIONS = 1_536;

// ── Implementation ─────────────────────────────────────────────────────────────

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local/hash";
  readonly dimensions = DIMENSIONS;

  async embedOne(text: string): Promise<number[]> {
    return textToVector(text, DIMENSIONS);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    // Pure CPU computation — no I/O needed, so we run synchronously and
    // just wrap in a resolved promise to satisfy the async interface.
    return texts.map((t) => textToVector(t, DIMENSIONS));
  }
}

// ── Core algorithm ─────────────────────────────────────────────────────────────

/**
 * Projects `text` into a `dims`-dimensional float vector using a dual-hash
 * bag-of-words approach, then L2-normalises the result.
 *
 * The dual-hash strategy (primary hash → dimension i, secondary hash → dimension j)
 * means each token influences two independent dimensions.  This halves the
 * expected collision rate compared to a single hash and produces slightly more
 * discriminative vectors.
 */
function textToVector(text: string, dims: number): number[] {
  const vec = new Float64Array(dims);

  // Tokenise: lowercase, strip non-alphanumeric, split on whitespace.
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    // Primary hash → increments dimension by 1.0 (full weight)
    const i = Math.abs(polyHash(token, 31)) % dims;
    vec[i] += 1.0;

    // Secondary hash (different seed) → increments by 0.5 (half weight)
    // The second seed shifts the hash space so i and j are rarely equal.
    const j = Math.abs(polyHash(token, 37)) % dims;
    vec[j] += 0.5;
  }

  return l2Normalise(vec);
}

/**
 * Polynomial rolling hash with a configurable prime multiplier.
 * Returns a signed 32-bit integer (JavaScript bitwise operations truncate to 32 bits).
 *
 * Using different `prime` values for the primary and secondary hash produces
 * statistically independent dimension assignments for the same token.
 */
function polyHash(str: string, prime: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    // Truncate to 32 bits with `| 0` at each step to avoid float accumulation.
    hash = (Math.imul(hash, prime) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Returns the L2-normalised version of `vec` as a plain number[].
 * If the vector is all zeros (empty input), returns a zero vector rather than
 * dividing by zero.
 */
function l2Normalise(vec: Float64Array): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];

  const magnitude = Math.sqrt(sumSq);
  if (magnitude === 0) return Array.from(vec); // zero vector for empty input

  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / magnitude;
  return out;
}
