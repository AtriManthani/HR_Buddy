/**
 * lib/config/env.ts — central server-side environment configuration.
 *
 * This is the SINGLE source of truth for all environment variables.
 * Every other module in lib/ and app/api/ must import from here.
 * Direct process.env access is intentionally avoided everywhere else.
 *
 * CLIENT-SIDE GUARD:
 *   This module throws immediately if imported in a browser context.
 *   That makes it impossible for a client component to accidentally pull
 *   in the OpenAI key or any other secret, even via an indirect import chain.
 *
 * VALIDATION:
 *   Required variables are checked at module load time.
 *   Missing required vars throw a descriptive error on server startup,
 *   not silently at the point of first use.
 *
 * USAGE:
 *   import { env } from "@/lib/config/env";
 *   env.OPENAI_API_KEY   // string, validated
 *   env.OPENAI_MODEL     // string, with default
 */

// ── Client-side guard ────────────────────────────────────────────────────────
// Throws if this module is ever imported in a browser bundle.
// Next.js server components and API routes run in Node.js — this is safe there.
if (typeof window !== "undefined") {
  throw new Error(
    "[env] lib/config/env.ts was imported on the client side. " +
      "All OpenAI and secret access must stay server-side. " +
      "Check that no 'use client' component imports this module directly or transitively."
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function require(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `[env] Required environment variable "${key}" is missing or empty. ` +
        "Set it in .env.local (development) or in your production environment variables."
    );
  }
  return value.trim();
}

function optional(key: string, defaultValue: string): string {
  return process.env[key]?.trim() || defaultValue;
}

function optionalNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) {
    throw new Error(
      `[env] Environment variable "${key}" must be a number, got: "${raw}"`
    );
  }
  return parsed;
}

// ── Validated environment object ─────────────────────────────────────────────

export const env = {
  // ── OpenAI ─────────────────────────────────────────────────────────────────

  /**
   * OpenAI secret API key.
   * Required in production (real pipeline).
   * Optional when DEMO_MODE=true — a placeholder value is used and the
   * OpenAI client is never called (the demo handler short-circuits first).
   */
  OPENAI_API_KEY: process.env.DEMO_MODE === "true"
    ? (process.env.OPENAI_API_KEY ?? "demo-mode-no-key-needed")
    : require("OPENAI_API_KEY"),

  /**
   * Chat completion model.
   * Env key: OPENAI_MODEL
   * Default: gpt-4o-mini
   */
  OPENAI_MODEL: optional("OPENAI_MODEL", "gpt-4o"),

  /**
   * Embedding model used for both ingestion and query-time embedding.
   * Env key: OPENAI_EMBEDDING_MODEL
   * Default: text-embedding-3-small
   */
  OPENAI_EMBEDDING_MODEL: optional(
    "OPENAI_EMBEDDING_MODEL",
    "text-embedding-3-small"
  ),

  // ── Vector Store ────────────────────────────────────────────────────────────

  /**
   * Which vector store backend to use.
   * Env key: VECTOR_STORE_PROVIDER
   * Allowed values: "local" | "pinecone"
   * Default: "local"
   *
   * "local"   — reads data/embeddings/index.json from the filesystem.
   *             Zero external dependencies. Good for small document sets.
   * "pinecone" — uses the Pinecone client (requires PINECONE_API_KEY).
   *             Swap in for large document sets or multi-tenant deployments.
   */
  VECTOR_STORE_PROVIDER: optional("VECTOR_STORE_PROVIDER", "local") as
    | "local"
    | "pinecone",

  /**
   * Pinecone API key. Only required when VECTOR_STORE_PROVIDER=pinecone.
   * Validated lazily in lib/rag/vectorStore.ts.
   */
  PINECONE_API_KEY: process.env.PINECONE_API_KEY?.trim() ?? "",

  /**
   * Pinecone index name. Only required when VECTOR_STORE_PROVIDER=pinecone.
   */
  PINECONE_INDEX: process.env.PINECONE_INDEX?.trim() ?? "",

  // ── Session ─────────────────────────────────────────────────────────────────

  /**
   * Secret used to sign session identifiers.
   * Required. Must be at least 32 characters.
   */
  SESSION_SECRET: (() => {
    // In DEMO_MODE the session store is still used (in-memory UUIDs), but
    // no cryptographic signing requires a real secret, so accept a placeholder.
    if (process.env.DEMO_MODE === "true") {
      return process.env.SESSION_SECRET ?? "demo-mode-placeholder-session-secret-32c";
    }
    const val = require("SESSION_SECRET");
    if (val.length < 32) {
      throw new Error(
        '[env] SESSION_SECRET must be at least 32 characters. ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    return val;
  })(),

  /**
   * Max conversation turns retained per session.
   * Default: 6
   */
  SESSION_MAX_TURNS: optionalNumber("SESSION_MAX_TURNS", 12),

  // ── Embedding provider ──────────────────────────────────────────────────────

  /**
   * Which embedding provider to use.
   * Env key: EMBEDDING_PROVIDER
   * Allowed values: "openai" | "local"
   * Default: "openai"
   *
   * "openai" — OpenAI text-embedding-3-small (1 536 dimensions).
   *            Requires OPENAI_API_KEY.  Production default.
   * "local"  — LocalHashEmbeddingProvider: deterministic bag-of-words
   *            projection, no API key needed.  For development / CI only.
   *            Retrieval quality is lower; vectors are NOT semantically aware.
   *
   * Changing this value after data/index.json has been built requires a full
   * re-ingest because the two providers produce incompatible vector spaces.
   */
  EMBEDDING_PROVIDER: optional("EMBEDDING_PROVIDER", "openai") as
    | "openai"
    | "local",

  // ── RAG ────────────────────────────────────────────────────────────────────

  /**
   * Number of top-k chunks returned by the retriever per query.
   * Default: 10 — enough for comprehensive list/table queries.
   */
  RAG_TOP_K: optionalNumber("RAG_TOP_K", 15),

  /**
   * Minimum cosine similarity score for a chunk to be included (0.0–1.0).
   * Chunks below this threshold are discarded even if in the top-k.
   * Default: 0.45 — OpenAI text-embedding-3-small scores HR policy queries
   * in the 0.45–0.68 range; 0.75 was too tight and blocked most topics.
   */
  RAG_MIN_SCORE: optionalNumber("RAG_MIN_SCORE", 0.45),

  // ── App ────────────────────────────────────────────────────────────────────

  /** NODE_ENV — "development" | "production" | "test" */
  NODE_ENV: optional("NODE_ENV", "development") as
    | "development"
    | "production"
    | "test",

  /** True when running in production */
  IS_PRODUCTION: process.env.NODE_ENV === "production",
} as const;

// Type export for use in function signatures
export type Env = typeof env;
