/**
 * scripts/extract.ts — Stage 1: extract plain text from source documents.
 *
 * Run with:
 *   npm run extract
 *
 * What it does:
 *   1. Reads every file in data/raw/  (.pdf, .txt, .md)
 *   2. Converts each to normalized UTF-8 plain text:
 *        .pdf  — text layer extracted via pdf-parse (machine-readable PDFs only).
 *                Image-only PDFs produce an empty result and are skipped.
 *        .txt  — read directly; whitespace-normalized.
 *        .md   — read directly; Markdown link syntax [label](url) stripped.
 *   3. For PDF files: detects and removes repeated headers/footers by
 *      identifying lines that appear in the first or last 3 lines of
 *      more than 40 % of pages (e.g. "City of Cleveland", "Confidential").
 *   4. Embeds page-boundary markers "--- PAGE N ---" so that
 *      scripts/chunk.ts can recover page numbers for chunk metadata.
 *   5. Applies text normalization: smart quotes → ASCII, em/en dashes →
 *      hyphens, non-breaking spaces → regular spaces, 3+ blank lines → 2.
 *   6. Writes one .txt file per source document to data/processed/
 *        e.g.  data/raw/Vacation-Policy-2023-11-15.pdf
 *          →   data/processed/Vacation-Policy-2023-11-15.txt
 *
 * Incremental mode (default):
 *   Skips a file if its counterpart in data/processed/ already exists AND
 *   the source file has not been modified since.  Pass --force to re-extract
 *   all documents regardless.
 *
 * Dependencies:
 *   pdf-parse — already installed via `npm install pdf-parse @types/pdf-parse`
 *
 * Assumptions:
 *   - PDFs have a machine-readable text layer.  Scanned images are skipped
 *     with a warning (OCR is out of scope for this pipeline).
 *   - The first non-empty line of the extracted text is the document title
 *     (used downstream by scripts/chunk.ts → inferPolicyTitle).
 *   - This script never modifies data/raw/ or any directory besides data/processed/.
 */

import * as dotenv from "dotenv";
import * as path   from "path";
import * as fs     from "fs";
// pdf-parse uses a CommonJS default export; `= require(...)` handles it
// correctly under both esModuleInterop and plain CommonJS compilation.
import pdfParse = require("pdf-parse");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ── Paths ──────────────────────────────────────────────────────────────────────

const RAW_DIR       = path.resolve(__dirname, "../data/raw");
const PROCESSED_DIR = path.resolve(__dirname, "../data/processed");

// ── Supported formats ──────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = [".pdf", ".txt", ".md"] as const;
type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

// ── Header / footer detection ──────────────────────────────────────────────────

/**
 * Minimum fraction of pages a line must appear on (in the first or last
 * 3 lines of each page) to be classified as a repeated header or footer.
 * 0.40 = 40 % — catches "City of Cleveland" on 6 of 15 pages, but won't
 * incorrectly remove a line that just happens to repeat in 2-3 sections.
 */
const HEADER_FOOTER_THRESHOLD = 0.4;

/**
 * Normalises a line for comparison against the header/footer set.
 * Strips page-number tokens so "Page 3 of 15" and "Page 7 of 15" both
 * normalise to the same string ("page of") and count as the same pattern.
 */
function normalizeLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/[-–—]?\s*\bpage\s+\d+(\s+of\s+\d+)?\b\s*[-–—]?/gi, "")
    .replace(/\b\d+\s+of\s+\d+\b/g, "")  // "3 of 15" standalone
    .replace(/^\s*\d+\s*$/, "")           // lone page number on its own line
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identifies lines that appear near the top or bottom of many pages and are
 * therefore likely boilerplate headers/footers.
 *
 * @returns A Set of normalised line strings that should be stripped.
 */
function detectHeadersFooters(pages: string[]): Set<string> {
  // Need at least a few pages to detect a reliable pattern.
  if (pages.length < 3) return new Set();

  const lineCounts = new Map<string, number>();
  const N = 3; // inspect the first/last N lines of each page

  for (const page of pages) {
    const lines = page.split("\n").map((l) => l.trim()).filter(Boolean);
    const candidates = [...lines.slice(0, N), ...lines.slice(-N)];

    // Use a per-page Set so the same line counted at both top AND bottom of
    // a short page doesn't inflate its count artificially.
    const seenThisPage = new Set<string>();
    for (const line of candidates) {
      const norm = normalizeLine(line);
      if (norm.length < 3 || norm.length > 120) continue;
      if (!seenThisPage.has(norm)) {
        lineCounts.set(norm, (lineCounts.get(norm) ?? 0) + 1);
        seenThisPage.add(norm);
      }
    }
  }

  const threshold = pages.length * HEADER_FOOTER_THRESHOLD;
  const headerFooterLines = new Set<string>();
  for (const [norm, count] of lineCounts) {
    if (count >= threshold) headerFooterLines.add(norm);
  }
  return headerFooterLines;
}

// ── Text normalisation ─────────────────────────────────────────────────────────

/**
 * Applies character and whitespace normalisation to extracted text.
 * This runs after header/footer removal so the line counts aren't skewed.
 */
function normalizeText(text: string): string {
  return (
    text
      // Smart / curly quotes → ASCII equivalents
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // Em-dash / en-dash → hyphen (retains meaning; avoids encoding issues)
      .replace(/[\u2013\u2014]/g, "-")
      // Non-breaking space → regular space
      .replace(/\u00A0/g, " ")
      // Trim trailing whitespace on every line
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
      // Collapse 3+ consecutive blank lines to exactly 2
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ── Extraction implementations ─────────────────────────────────────────────────

/**
 * Extracts text from a PDF file with page markers and header/footer removal.
 *
 * Steps:
 *   1. Parse with pdf-parse to read the text layer.
 *   2. Split into individual pages on the form-feed character (\f) that
 *      pdf-parse inserts at each page boundary.
 *   3. Detect and strip repeated header/footer boilerplate.
 *   4. Reassemble with "--- PAGE N ---" markers for the chunker.
 *
 * Throws if the PDF has no machine-readable text.
 */
async function extractPdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  if (!data.text || data.text.trim().length === 0) {
    throw new Error(
      "PDF has no machine-readable text layer (likely a scanned image). " +
        "OCR is required but is not supported in this pipeline."
    );
  }

  // pdf-parse inserts \f (form feed, U+000C) between pages.
  const rawPages = data.text.split("\f");
  const pages = rawPages.filter((p: string) => p.trim().length > 0);

  const headerFooterLines = detectHeadersFooters(pages);

  const pageBlocks: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const lines = pages[i].split("\n");

    // Drop any line whose normalised form is in the header/footer set.
    const filtered = lines.filter((line: string) => {
      const norm = normalizeLine(line.trim());
      return norm.length === 0 || !headerFooterLines.has(norm);
    });

    const pageText = filtered.join("\n").trim();
    if (pageText.length > 0) {
      pageBlocks.push(`--- PAGE ${pageNum} ---\n${pageText}`);
    }
  }

  return normalizeText(pageBlocks.join("\n\n"));
}

/**
 * Reads a plain .txt or .md file and normalises its content.
 * For .md files, Markdown link syntax [label](url) is stripped to plain label.
 * No page markers are inserted — page number metadata will be absent for these.
 */
function extractPlainText(filePath: string, ext: ".txt" | ".md"): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  const text =
    ext === ".md"
      ? raw.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      : raw;
  return normalizeText(text);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  console.log("=== Stage 1: Extract ===\n");

  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return (
        SUPPORTED_EXTENSIONS.includes(ext as SupportedExt) &&
        !f.startsWith(".") &&  // skip .gitkeep, .DS_Store
        f !== "README.md"      // data/raw/README.md is documentation, not a policy
      );
    });

  if (files.length === 0) {
    console.warn(
      "No supported files found in data/raw/.\n" +
        "Add .pdf, .txt, or .md files and re-run.\n" +
        "See data/raw/README.md for naming conventions."
    );
    process.exit(0);
  }

  console.log(
    `Found ${files.length} source file(s):\n` +
      files.map((f) => `  - ${f}`).join("\n") +
      "\n"
  );

  let extracted = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const file of files) {
    const srcPath  = path.join(RAW_DIR, file);
    const baseName = path.basename(file, path.extname(file));
    const outPath  = path.join(PROCESSED_DIR, `${baseName}.txt`);

    // Incremental: skip if the output already exists and source is unchanged.
    if (!force && fs.existsSync(outPath)) {
      const srcMtime = fs.statSync(srcPath).mtimeMs;
      const outMtime = fs.statSync(outPath).mtimeMs;
      if (outMtime >= srcMtime) {
        console.log(`  SKIP  ${file}  (up to date)`);
        skipped++;
        continue;
      }
    }

    const ext = path.extname(file).toLowerCase() as SupportedExt;

    try {
      let text: string;

      switch (ext) {
        case ".pdf":
          text = await extractPdf(srcPath);
          break;
        case ".txt":
          text = extractPlainText(srcPath, ".txt");
          break;
        case ".md":
          text = extractPlainText(srcPath, ".md");
          break;
        default: {
          // TypeScript exhaustiveness — should never reach here given the filter above.
          const _exhaustive: never = ext;
          throw new Error(`Unsupported extension: ${_exhaustive}`);
        }
      }

      fs.writeFileSync(outPath, text, "utf-8");
      console.log(`  OK    ${file}  →  ${path.basename(outPath)}`);
      extracted++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL  ${file}  —  ${msg}`);
      failed++;
      // Continue processing the remaining files rather than aborting the run.
    }
  }

  console.log(
    `\nDone.  Extracted: ${extracted},  Skipped: ${skipped},  Failed: ${failed}\n` +
      (failed > 0 ? "Some files could not be extracted — check the errors above.\n" : "") +
      "Run 'npm run chunk' to proceed to Stage 2 (chunking)."
  );
}

main().catch((err) => {
  console.error("\nExtraction failed unexpectedly:", err);
  process.exit(1);
});
