/**
 * types/rag.ts — retrieval-augmented generation primitives.
 *
 * Covers the full lifecycle of a policy document:
 *   raw text → RawChunk (chunker output)
 *             → PolicyChunk (embedding added, written to index.json)
 *             → RetrievedChunk (cosine score added, returned to route)
 *
 * Also includes IngestRecord, the top-level shape persisted to
 * data/index.json by scripts/ingest.ts.
 */

// ── Chunk metadata ─────────────────────────────────────────────────────────────

/**
 * Metadata attached to every stored document chunk.
 * Preserved through all three chunk stages (Raw → Policy → Retrieved).
 */
export interface ChunkMetadata {
  /** Original file name inside data/raw/ (e.g. "Vacation-Policy-2023-11-15.pdf") */
  sourceFile: string;
  /** Human-readable policy title (e.g. "Annual Leave Policy") */
  policyTitle: string;
  /** Section heading the chunk belongs to, if parseable from the document */
  section?: string;
  /** Page number (1-based, PDF source) or line number (plain-text source) */
  pageOrLine?: number;
  /**
   * High-level policy category inferred from the filename.
   * Possible values: "Leave & Benefits" | "Workplace Safety" |
   *   "Ethics & Compliance" | "General HR Policy"
   */
  policyCategory?: string;
  /** Zero-based position of this chunk within its source document (for ordering). */
  chunkIndex?: number;
}

// ── Chunk lifecycle ────────────────────────────────────────────────────────────

/**
 * A chunk of policy text as it leaves the chunker, before embedding.
 * Produced by lib/rag/chunker.ts; consumed by scripts/ingest.ts.
 */
export interface RawChunk {
  text: string;
  metadata: ChunkMetadata;
}

/**
 * A chunk that has been assigned an embedding vector and a stable ID.
 * This is the unit of storage written to data/index.json.
 */
export interface PolicyChunk {
  /** Stable identifier — UUID v4 generated at ingest time */
  id: string;
  text: string;
  /** OpenAI text-embedding-3-small output (1 536 dimensions) */
  embedding: number[];
  metadata: ChunkMetadata;
}

/**
 * A PolicyChunk augmented with a cosine-similarity relevance score.
 * Returned by lib/rag/retriever.ts after a nearest-neighbour search.
 */
export interface RetrievedChunk extends PolicyChunk {
  /** Cosine similarity against the query embedding (0.0 – 1.0) */
  score: number;
}

// ── Vector store record ────────────────────────────────────────────────────────

/**
 * Top-level record persisted to data/index.json.
 * Wraps PolicyChunk[] with provenance metadata so the store is
 * self-describing and can be re-ingested or inspected independently.
 */
export interface IngestRecord {
  /** ISO-8601 timestamp of when ingest was last run */
  ingestedAt: string;
  /** Number of source documents processed */
  documentCount: number;
  /** Total chunks written to the store */
  chunkCount: number;
  chunks: PolicyChunk[];
}
