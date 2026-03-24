/**
 * lib/rag/vectorStore.ts — in-memory vector store backed by data/index.json.
 *
 * Responsibilities:
 * - Reads data/index.json from disk once, at cold-start, and holds it in memory.
 * - Validates the file's schema and throws descriptive errors on bad data.
 * - Exposes getAllChunks() for the retriever to compute cosine similarity.
 *
 * Architecture note:
 *   This is an intentionally simple file-based store.  index.json is generated
 *   by scripts/ingest.ts and is read-only at runtime.  For large document sets
 *   (> 10 k chunks) or multi-tenant deployments, swap this module's internals
 *   for a Pinecone / Supabase pgvector / Qdrant client without changing the
 *   public API (search signature stays the same).
 *
 * Runtime note:
 *   The index is read at cold-start time and kept in module-level memory for
 *   the lifetime of the server process:
 *     - index.json is read-only (never written at runtime).
 *     - Cold-start read of a ~50 MB JSON takes ~200 ms (acceptable).
 *
 * Expected dimensions: 1 536 (text-embedding-3-small).
 * If you switch models, re-run `npm run ingest` before redeploying.
 */

import * as fs   from "fs";
import * as path from "path";
import type { PolicyChunk, IngestRecord } from "@/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const INDEX_PATH = path.resolve(process.cwd(), "data/index.json");

/**
 * Expected embedding dimensionality.  Checked at load time so a stale index
 * built with a different model is caught immediately, not silently producing
 * wrong similarity scores.
 */
const EXPECTED_DIMENSIONS = 1_536;

// ── In-memory store ────────────────────────────────────────────────────────────

/** Populated by initVectorStore(); empty until then. */
let store: PolicyChunk[] = [];
let initialized = false;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Reads and validates data/index.json, then loads all PolicyChunks into memory.
 *
 * Safe to call multiple times — subsequent calls are no-ops once the store is
 * successfully initialised.
 *
 * Throws with a descriptive message if:
 *   - index.json does not exist (user hasn't run `npm run ingest` yet).
 *   - index.json cannot be parsed as JSON.
 *   - The parsed object is missing required top-level fields.
 *   - Chunk embeddings have the wrong dimensionality.
 */
export async function initVectorStore(): Promise<void> {
  if (initialized) return;

  // ── Read file ──────────────────────────────────────────────────────────────

  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(
      `[vectorStore] data/index.json not found at ${INDEX_PATH}.\n` +
        "Run the ingestion pipeline to generate it:\n" +
        "  npm run ingest:full"
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(INDEX_PATH, "utf-8");
  } catch (err) {
    throw new Error(`[vectorStore] Could not read data/index.json: ${String(err)}`);
  }

  // ── Parse ──────────────────────────────────────────────────────────────────

  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error(
      "[vectorStore] data/index.json is not valid JSON.  " +
        "Re-run `npm run ingest` to regenerate it."
    );
  }

  // ── Validate top-level schema ──────────────────────────────────────────────

  if (!isIngestRecord(record)) {
    throw new Error(
      "[vectorStore] data/index.json is missing required fields " +
        "(ingestedAt, chunkCount, chunks).  " +
        "Re-run `npm run ingest` to regenerate it."
    );
  }

  if (record.chunks.length !== record.chunkCount) {
    console.warn(
      `[vectorStore] chunkCount (${record.chunkCount}) does not match ` +
        `actual chunk array length (${record.chunks.length}).  ` +
        "Index may be corrupt — consider re-running `npm run ingest`."
    );
  }

  // ── Validate embedding dimensions on the first chunk ──────────────────────

  if (record.chunks.length > 0) {
    const dim = record.chunks[0].embedding.length;
    if (dim !== EXPECTED_DIMENSIONS) {
      throw new Error(
        `[vectorStore] Unexpected embedding dimension: ${dim} ` +
          `(expected ${EXPECTED_DIMENSIONS}).  ` +
          "Re-run `npm run ingest` after switching embedding models."
      );
    }
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  store = record.chunks;
  initialized = true;

  console.log(
    `[vectorStore] Loaded ${store.length} chunks ` +
      `(ingested at ${record.ingestedAt}).`
  );
}

/**
 * Returns all chunks currently loaded in the store.
 * Used by the retriever to compute cosine similarity scores.
 * Throws if initVectorStore() has not been called yet.
 */
export function getAllChunks(): PolicyChunk[] {
  if (!initialized) {
    throw new Error(
      "[vectorStore] getAllChunks() called before initVectorStore().  " +
        "Ensure initVectorStore() is awaited at server startup."
    );
  }
  return store;
}

/** Returns the number of chunks currently loaded. */
export function getStoreSize(): number {
  return store.length;
}

// ── Type guard ─────────────────────────────────────────────────────────────────

function isIngestRecord(value: unknown): value is IngestRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.ingestedAt === "string" &&
    typeof r.chunkCount === "number" &&
    Array.isArray(r.chunks)
  );
}
