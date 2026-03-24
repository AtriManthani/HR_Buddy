/**
 * lib/rag/embedding/OpenAIEmbeddingProvider.ts
 *
 * Production embedding provider backed by OpenAI text-embedding-3-small.
 *
 * Characteristics:
 *   - 1 536-dimensional dense vectors.
 *   - Cosine similarity on L2-normalised vectors is well-calibrated:
 *     relevant HR policy passages typically score > 0.75 against matching queries.
 *   - Cost: $0.02 / 1M tokens — roughly $0.002 for the full 715-chunk corpus.
 *
 * Retry policy:
 *   Retries once on HTTP 429 (rate limit) with a 10-second back-off.
 *   For the ingest script, the outer loop splits large sets into BATCH_SIZE=100
 *   chunks before calling embedMany(), so retries are narrow in scope.
 *
 * Configuration (via environment variables, never hardcoded):
 *   OPENAI_API_KEY            — required when this provider is active.
 *   OPENAI_EMBEDDING_MODEL    — optional; defaults to "text-embedding-3-small".
 *
 * The OpenAI client is created lazily on first use (not at import time).
 * This allows scripts to call dotenv.config() before any API key validation,
 * avoiding the CommonJS import-hoisting trap.
 */

import OpenAI from "openai";
import type { EmbeddingProvider } from "./EmbeddingProvider";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "text-embedding-3-small";
const DIMENSIONS    = 1_536;
const RETRY_DELAY_MS = 10_000;

// ── Implementation ─────────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;

  /** Returns the provider+model identifier for logging. */
  get name(): string {
    return `openai/${this.modelName()}`;
  }

  // ── Lazy client ──────────────────────────────────────────────────────────────

  private _client: OpenAI | null = null;

  private client(): OpenAI {
    if (!this._client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "[OpenAIEmbeddingProvider] OPENAI_API_KEY is not set.\n" +
            "Set it in .env.local (local dev / scripts) or in your " +
            "hosting environment."
        );
      }
      this._client = new OpenAI({ apiKey });
    }
    return this._client;
  }

  private modelName(): string {
    return process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
  }

  // ── EmbeddingProvider interface ───────────────────────────────────────────────

  async embedOne(text: string): Promise<number[]> {
    const response = await this.client().embeddings.create({
      model: this.modelName(),
      input: text.trim(),
    });
    return response.data[0].embedding;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return this.withRetry(() => this.callAPI(texts));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private async callAPI(texts: string[]): Promise<number[][]> {
    const response = await this.client().embeddings.create({
      model: this.modelName(),
      input: texts,
    });
    // The OpenAI API spec guarantees index-order alignment, but we sort
    // defensively to guard against future spec changes or proxy middleware.
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      if (this.isRateLimit(err)) {
        console.warn(
          `[OpenAIEmbeddingProvider] Rate limit (429) — ` +
            `waiting ${RETRY_DELAY_MS / 1_000}s then retrying…`
        );
        await sleep(RETRY_DELAY_MS);
        return await fn(); // single retry; let it propagate on second failure
      }
      throw err;
    }
  }

  private isRateLimit(err: unknown): boolean {
    return err instanceof OpenAI.APIError && err.status === 429;
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
