/**
 * scripts/chunk.ts — Stage 2: split extracted text into embeddable chunks.
 *
 * Run with:
 *   npm run chunk
 *
 * What it does:
 *   1. Reads every .txt file in data/processed/ (written by scripts/extract.ts).
 *   2. Infers policyTitle from the first non-empty, non-marker line of the file.
 *   3. Calls lib/rag/chunker.ts → chunkDocument() which:
 *        - Parses "--- PAGE N ---" markers to track page numbers.
 *        - Detects section headings (ALL CAPS, numbered, Markdown #, etc.).
 *        - Splits each section into overlapping ~1 600-char / ~400-token windows.
 *        - Prepends the section heading to each window for better retrieval.
 *        - Attaches metadata: sourceFile, policyTitle, section, pageOrLine,
 *          policyCategory, chunkIndex.
 *   4. Serialises each RawChunk[] to a .chunks.jsonl file in data/chunks/
 *      (one JSON object per line, UTF-8, no trailing comma):
 *        data/processed/Vacation-Policy-2023-11-15.txt
 *          →  data/chunks/Vacation-Policy-2023-11-15.chunks.jsonl
 *
 * Incremental mode (default):
 *   Skips documents whose .chunks.jsonl output is newer than the .txt source.
 *   Pass --force to re-chunk all documents unconditionally.
 *
 * Output format (one JSON object per line):
 *   { "text": "...", "metadata": { "sourceFile": "...", "policyTitle": "...",
 *     "section": "...", "pageOrLine": 1, "policyCategory": "...", "chunkIndex": 0 } }
 *
 * Usage:
 *   npm run chunk             # incremental
 *   npm run chunk -- --force  # full re-chunk
 */

import * as dotenv from "dotenv";
import * as path   from "path";
import * as fs     from "fs";
import { chunkDocument } from "../lib/rag/chunker";
import type { RawChunk } from "../types/rag";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Paths ──────────────────────────────────────────────────────────────────────

const PROCESSED_DIR = path.resolve(__dirname, "../data/processed");
const CHUNKS_DIR    = path.resolve(__dirname, "../data/chunks");

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Infers a human-readable policy title from the processed text.
 *
 * Strategy:
 *   1. First pass (lines 1–40): find the first line that looks like a policy
 *      title — it must contain a keyword like POLICY, PROCEDURE, GUIDELINES,
 *      be < 80 characters, and not be a generic org-header line.
 *      This handles City of Cleveland PDFs which begin with:
 *        "CITY OF CLEVELAND"            ← org header, skip
 *        "Human Resources Policies..."  ← section header, skip
 *        "VACATION LEAVE POLICY"        ← ✓ this is the title
 *   2. Second pass: first non-empty, non-marker, non-org-header line.
 *   3. Fallback: derive from the source filename (strip date suffix).
 */
function inferPolicyTitle(text: string, sourceFile: string): string {
  const PAGE_MARKER_RE = /^---\s+PAGE\s+\d+\s+---$/;

  // Lines containing these phrases are org / section headers, not titles.
  const SKIP_RE =
    /^(CITY OF|HUMAN RESOURCES|DEPARTMENT OF|OFFICE OF|BENEFIT POLICIES?|ADMINISTRATION|HR POLICIES|POLICIES AND PROCEDURES?|EMPLOYMENT POLICIES?)/i;

  // A line qualifies as the policy title if it contains one of these keywords.
  const TITLE_KEYWORD_RE =
    /\b(POLICY|PROCEDURE|PROCEDURES|GUIDELINES?|ACT|OVERVIEW|RULES?|STANDARDS?)\b/i;

  const lines = text.split("\n");

  // Pass 1 — look for a line with a recognisable title keyword in the first 40 lines.
  for (const line of lines.slice(0, 40)) {
    const trimmed = line.trim();
    if (!trimmed || PAGE_MARKER_RE.test(trimmed) || SKIP_RE.test(trimmed)) continue;
    if (TITLE_KEYWORD_RE.test(trimmed) && trimmed.length < 80) {
      return trimmed.replace(/^#+\s+/, "").trim();
    }
  }

  // Pass 2 — first non-empty, non-skip, non-marker line anywhere in the document.
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || PAGE_MARKER_RE.test(trimmed) || SKIP_RE.test(trimmed)) continue;
    return trimmed.replace(/^#+\s+/, "").trim();
  }

  // Fallback — derive from filename: "Vacation-Policy-2023-11-15" → "Vacation Policy"
  return path
    .basename(sourceFile, path.extname(sourceFile))
    .replace(/[-_]/g, " ")
    .replace(/\s+\d{4}(\s+\d{2}){0,2}\s*$/, "")
    .trim();
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  console.log("=== Stage 2: Chunk ===\n");

  fs.mkdirSync(CHUNKS_DIR, { recursive: true });

  const files = fs
    .readdirSync(PROCESSED_DIR)
    .filter((f) => f.endsWith(".txt") && !f.startsWith("."));

  if (files.length === 0) {
    console.warn(
      "No .txt files found in data/processed/.\n" +
        "Run 'npm run extract' first to populate data/processed/."
    );
    process.exit(0);
  }

  console.log(
    `Found ${files.length} processed file(s):\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n"
  );

  let chunked     = 0;
  let skipped     = 0;
  let failed      = 0;
  let totalChunks = 0;

  for (const file of files) {
    const srcPath  = path.join(PROCESSED_DIR, file);
    const baseName = path.basename(file, ".txt");
    const outPath  = path.join(CHUNKS_DIR, `${baseName}.chunks.jsonl`);

    // Incremental: skip if output is newer than the source.
    if (!force && fs.existsSync(outPath)) {
      const srcMtime = fs.statSync(srcPath).mtimeMs;
      const outMtime = fs.statSync(outPath).mtimeMs;
      if (outMtime >= srcMtime) {
        console.log(`  SKIP  ${file}  (up to date)`);
        skipped++;
        continue;
      }
    }

    try {
      const text = fs.readFileSync(srcPath, "utf-8");

      // The sourceFile for metadata is the original raw file (before extraction),
      // so we reconstruct it as "<baseName>.pdf" (or ".txt" / ".md" if applicable).
      // Since our corpus is all PDFs, we default to ".pdf".  For a mixed corpus,
      // a sidecar metadata file or a naming convention would be needed.
      const sourceFile = `${baseName}.pdf`;

      const policyTitle = inferPolicyTitle(text, sourceFile);
      const chunks: RawChunk[] = chunkDocument(text, sourceFile, policyTitle);

      // Write one JSON object per line (JSONL / NDJSON format).
      const jsonl = chunks.map((chunk) => JSON.stringify(chunk)).join("\n");
      fs.writeFileSync(outPath, jsonl + "\n", "utf-8");

      console.log(`  OK    ${file}  →  ${chunks.length} chunk(s)`);
      chunked++;
      totalChunks += chunks.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL  ${file}  —  ${msg}`);
      failed++;
    }
  }

  console.log(
    `\nDone.  Chunked: ${chunked} file(s), ${totalChunks} total chunk(s).  ` +
      `Skipped: ${skipped},  Failed: ${failed}\n` +
      (failed > 0 ? "Some files could not be chunked — check the errors above.\n" : "") +
      "Run 'npm run ingest' to proceed to Stage 3 (embedding + index)."
  );
}

main().catch((err) => {
  console.error("\nChunking failed unexpectedly:", err);
  process.exit(1);
});
