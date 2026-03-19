/**
 * scripts/ingest.ts — Stage 3: embed chunks and write the vector store index.
 *
 * Run with:
 *   npm run ingest
 *
 * What it does:
 *   1. Reads every .chunks.jsonl file from data/chunks/ (written by chunk.ts).
 *   2. Parses each line as a RawChunk.
 *   3. Embeds all chunks via OpenAI text-embedding-3-small in batches of 100
 *      (smaller batches improve retry granularity and stay well within the
 *      per-request item limit of 2 048).
 *   4. Assigns a stable UUID v4 to each chunk.
 *   5. Writes the complete IngestRecord to data/index.json atomically:
 *      writes to data/index.json.tmp first, then renames so a running
 *      server process never reads a partially-written file.
 *
 * Cost estimate (text-embedding-3-small, $0.02 / 1 M tokens):
 *   ~200 chunks × ~400 tokens = ~80 000 tokens = ~$0.002 per full ingest.
 *
 * Prerequisites:
 *   - OPENAI_API_KEY set in .env.local
 *   - data/chunks/ populated by 'npm run chunk' (Stage 2)
 *
 * Safety:
 *   - Only reads from data/chunks/; never touches data/raw/ or data/processed/.
 *   - Only writes to data/index.json (via atomic rename).
 *   - Cleans up the .tmp file on error.
 *
 * Usage:
 *   npm run ingest
 *   npm run ingest:full   # runs extract → chunk → ingest in sequence
 */

import * as dotenv from "dotenv";
import * as path   from "path";
import * as fs     from "fs";
import { randomUUID } from "crypto";
import { embedBatch } from "../lib/rag/embeddings";
import type { RawChunk, PolicyChunk, IngestRecord } from "../types/rag";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Paths ──────────────────────────────────────────────────────────────────────

const CHUNKS_DIR  = path.resolve(__dirname, "../data/chunks");
const OUTPUT_PATH = path.resolve(__dirname, "../data/index.json");
const TMP_PATH    = `${OUTPUT_PATH}.tmp`;

// ── Tuning ─────────────────────────────────────────────────────────────────────

/**
 * Number of chunks sent to OpenAI in a single embeddings API call.
 * 100 is well within the 2 048-item per-request limit and gives fine
 * retry granularity without excessive API round-trips.
 */
const BATCH_SIZE = 100;

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Stage 3: Embed & Index ===\n");

  // ── Validate environment ─────────────────────────────────────────────────────

  const provider = process.env.EMBEDDING_PROVIDER ?? "openai";
  console.log(`Embedding provider: ${provider}\n`);

  // OPENAI_API_KEY is only required for the "openai" provider.
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is not set.\n" +
        "Add it to .env.local and re-run, or set EMBEDDING_PROVIDER=local to\n" +
        "use the deterministic local provider (no API key required).\n" +
        "See .env.example for the required variables."
    );
    process.exit(1);
  }

  // ── Discover chunk files ─────────────────────────────────────────────────────

  if (!fs.existsSync(CHUNKS_DIR)) {
    console.error(
      "data/chunks/ does not exist.\n" +
        "Run 'npm run chunk' (Stage 2) before running ingest."
    );
    process.exit(1);
  }

  const chunkFiles = fs
    .readdirSync(CHUNKS_DIR)
    .filter((f) => f.endsWith(".chunks.jsonl") && !f.startsWith("."));

  if (chunkFiles.length === 0) {
    console.warn(
      "No .chunks.jsonl files found in data/chunks/.\n" +
        "Run 'npm run chunk' first to populate data/chunks/."
    );
    process.exit(0);
  }

  console.log(
    `Found ${chunkFiles.length} chunk file(s):\n` +
      chunkFiles.map((f) => `  - ${f}`).join("\n") +
      "\n"
  );

  // ── Parse all chunks ─────────────────────────────────────────────────────────

  const allChunks: RawChunk[] = [];

  for (const file of chunkFiles) {
    const filePath = path.join(CHUNKS_DIR, file);
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .filter(Boolean);

    for (const line of lines) {
      try {
        allChunks.push(JSON.parse(line) as RawChunk);
      } catch {
        console.warn(`  WARN  ${file}: could not parse line — skipping`);
      }
    }
  }

  if (allChunks.length === 0) {
    console.warn("All chunk files are empty.  Nothing to embed.");
    process.exit(0);
  }

  console.log(`Total chunks to embed: ${allChunks.length}\n`);

  // ── Embed in batches ─────────────────────────────────────────────────────────

  const policyChunks: PolicyChunk[] = [];
  const totalBatches = Math.ceil(allChunks.length / BATCH_SIZE);

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch   = allChunks.slice(i, i + BATCH_SIZE);
    const texts   = batch.map((c) => c.text);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`  Embedding batch ${batchNo} / ${totalBatches} …`);
    const vectors = await embedBatch(texts);
    process.stdout.write(`  done (${batch.length} chunks)\n`);

    for (let j = 0; j < batch.length; j++) {
      policyChunks.push({
        id:        randomUUID(),
        text:      batch[j].text,
        embedding: vectors[j],
        metadata:  batch[j].metadata,
      });
    }
  }

  // ── Write index atomically ───────────────────────────────────────────────────

  const record: IngestRecord = {
    ingestedAt:    new Date().toISOString(),
    documentCount: chunkFiles.length,
    chunkCount:    policyChunks.length,
    chunks:        policyChunks,
  };

  // Write to a .tmp file first, then rename.  If the server is running it
  // will either read the old index or the new one — never a partial write.
  fs.writeFileSync(TMP_PATH, JSON.stringify(record), "utf-8");
  fs.renameSync(TMP_PATH, OUTPUT_PATH);

  const indexSizeKb = Math.round(fs.statSync(OUTPUT_PATH).size / 1024);
  console.log(
    `\nWrote ${policyChunks.length} chunks to data/index.json (${indexSizeKb} KB).`
  );
  console.log("Ingest complete.  Restart the server to load the new index.");
}

main().catch((err) => {
  // Clean up the temporary file if something went wrong after it was created.
  if (fs.existsSync(TMP_PATH)) {
    try { fs.unlinkSync(TMP_PATH); } catch { /* best-effort cleanup */ }
  }
  console.error("\nIngest failed:", err);
  process.exit(1);
});
