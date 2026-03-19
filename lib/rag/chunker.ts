/**
 * lib/rag/chunker.ts — splits processed policy text into embeddable chunks.
 *
 * Only used by scripts/chunk.ts (never imported by the Next.js runtime).
 *
 * Input:  UTF-8 plain text written by scripts/extract.ts, which embeds
 *         page-boundary markers in the form "--- PAGE N ---".
 *
 * Output: RawChunk[] where every chunk carries:
 *   text:     chunk body, prepended with its section heading so that the
 *             embedding captures section context even for short passages.
 *   metadata: sourceFile, policyTitle, section, pageOrLine (start page),
 *             policyCategory (inferred from filename), chunkIndex.
 *
 * Chunking strategy:
 *   1. Parse "--- PAGE N ---" markers to track the current page number.
 *   2. Detect section headings using HEADING_PATTERNS (below).
 *   3. Accumulate body lines per section; flush when a new heading appears.
 *   4. Within each section apply splitWithOverlap:
 *      - Window size: ~1 600 characters (~400 tokens at 4 chars/token).
 *      - Step:        80% of window (1 280 chars) — 20% overlap kept.
 *      - Word-boundary alignment: windows never cut mid-word.
 *   5. Prepend the section heading to every window in that section.
 *      This ensures retrievals always include the heading, improving
 *      citation quality and similarity scoring.
 *
 * Assumptions about City of Cleveland HR PDFs after text extraction:
 *   - Top-level divisions use numbered or Roman-numeral prefixes.
 *   - Sub-headings use letter prefixes ("A. Definitions") or colons.
 *   - Markdown "#" headings appear in plain-text / .md source files.
 *   - All-caps short lines (< 100 chars, no terminal period) are headings.
 */

import type { RawChunk } from "@/types";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Target window size in characters.  ~1 600 chars ≈ 400 tokens at 4 chars/tok. */
const CHUNK_SIZE = 1_600;

/** Overlap between adjacent windows (20 % of CHUNK_SIZE). */
const CHUNK_OVERLAP = 320;

/** Fragments shorter than this are discarded as noise. */
const MIN_CHUNK_LENGTH = 80;

// ── Section-heading detection ──────────────────────────────────────────────────

/**
 * Patterns checked in order; first match classifies the line as a heading.
 * Ordered from most-specific (Markdown) to least-specific (ALL CAPS).
 */
const HEADING_PATTERNS: RegExp[] = [
  /^#{1,3}\s+\S/,                              // ## Section Title (Markdown)
  /^(SECTION|ARTICLE|PART|CHAPTER)\s+\d+/i,   // SECTION 3, Article II
  /^\d+\.\s+[A-Z][A-Z\s\-/&,]{2,}$/,          // 1. PURPOSE, 2. SCOPE
  /^[IVXLC]+\.\s+[A-Z][A-Z\s\-/&,]{2,}$/,     // I. POLICY, II. SCOPE (Roman)
  /^[A-Z]\.\s+[A-Z][A-Za-z\s\-/&,]{3,50}$/,   // A. Definitions, B. Procedure (≤ 55 chars)
  /^[A-Z][A-Z\s\-/&,]{4,79}$/,                // ALL CAPS HEADING (no period)
  /^[A-Z][a-zA-Z\s\-/&]{4,59}:$/,             // Title Case Heading:
];

const PAGE_MARKER_RE = /^---\s+PAGE\s+(\d+)\s+---$/;

/**
 * Org-level boilerplate lines that appear in City of Cleveland PDFs as
 * running headers on every page.  We exclude them from section detection so
 * they don't fragment the document into spurious one-line sections.
 */
const BOILERPLATE_HEADINGS = new Set([
  "CITY OF CLEVELAND",
  "HUMAN RESOURCES POLICIES AND PROCEDURES",
  "BENEFIT POLICIES",
  "EMPLOYMENT POLICIES",
  "ADMINISTRATION POLICIES",
  "WORKPLACE POLICIES",
]);

/** Returns true if the line looks like a section heading. */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 100) return false;
  // Exclude plain sentences: mixed-case text ending in a period.
  if (/[a-z]{4,}.*\.$/.test(t)) return false;
  // Exclude known org boilerplate that shows up as page-level running headers.
  if (BOILERPLATE_HEADINGS.has(t.toUpperCase())) return false;
  return HEADING_PATTERNS.some((re) => re.test(t));
}

/** Strips Markdown "#" characters from a heading for display. */
function cleanHeading(line: string): string {
  return line.trim().replace(/^#+\s+/, "");
}

// ── Policy-category inference ──────────────────────────────────────────────────

/**
 * Infers a high-level policy category from the source filename.
 * Specific to the City of Cleveland HR corpus; extend as the corpus grows.
 */
export function inferPolicyCategory(filename: string): string {
  const lower = filename.toLowerCase();

  if (/leave|vacation|parental|pump|pwfa|safe-leave/.test(lower)) {
    return "Leave & Benefits";
  }
  if (
    /harassment|discrimination|violence|domestic|sexual|drug|alcohol/.test(
      lower
    )
  ) {
    return "Workplace Safety";
  }
  if (/ethics|law/.test(lower)) {
    return "Ethics & Compliance";
  }
  // HR-Policies-Section-A/B/C cover broad general employment rules
  return "General HR Policy";
}

// ── Core public API ────────────────────────────────────────────────────────────

/**
 * Splits a processed policy document into overlapping RawChunks.
 *
 * @param processedText  UTF-8 text from data/processed/, with "--- PAGE N ---"
 *                       markers inserted by scripts/extract.ts.
 * @param sourceFile     Filename in data/raw/ (e.g. "Vacation-Policy-2023-11-15.pdf").
 * @param policyTitle    Human-readable title extracted from the document.
 */
export function chunkDocument(
  processedText: string,
  sourceFile: string,
  policyTitle: string
): RawChunk[] {
  const policyCategory = inferPolicyCategory(sourceFile);
  const lines = processedText.split("\n");

  // ── Step 1: Walk lines, tracking page numbers and section boundaries ─────────

  interface Section {
    heading: string;
    startPage: number;
    body: string; // body lines joined with newlines
  }

  const sections: Section[] = [];
  // Use the policy title as the implicit heading for any text that precedes
  // the first explicit heading (e.g. a preamble or "Purpose" paragraph).
  let currentHeading = policyTitle;
  let currentPage = 1;
  let currentStartPage = 1;
  let bodyLines: string[] = [];

  function flushSection() {
    const body = bodyLines.join("\n").trim();
    if (body.length >= MIN_CHUNK_LENGTH) {
      sections.push({ heading: currentHeading, startPage: currentStartPage, body });
    }
    bodyLines = [];
  }

  for (const line of lines) {
    const pageMatch = line.match(PAGE_MARKER_RE);
    if (pageMatch) {
      // Update page counter; do not include the marker in chunk text.
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    if (isHeading(line)) {
      flushSection();
      currentHeading = cleanHeading(line);
      currentStartPage = currentPage;
    } else {
      bodyLines.push(line);
    }
  }
  flushSection(); // flush the final section

  // ── Step 2: Sliding-window split within each section ─────────────────────────

  const allChunks: RawChunk[] = [];
  let globalChunkIndex = 0;

  for (const section of sections) {
    const windows = splitWithOverlap(section.body, CHUNK_SIZE, CHUNK_OVERLAP);

    for (const window of windows) {
      const trimmed = window.trim();
      if (trimmed.length < MIN_CHUNK_LENGTH) continue;

      // Prepend the section heading to every window so that:
      //   (a) embeddings capture the heading's semantics, and
      //   (b) citations can display the heading even for mid-section chunks.
      const chunkText =
        section.heading !== policyTitle
          ? `${section.heading}\n\n${trimmed}`
          : trimmed;

      allChunks.push({
        text: chunkText,
        metadata: {
          sourceFile,
          policyTitle,
          section: section.heading,
          pageOrLine: section.startPage,
          policyCategory,
          chunkIndex: globalChunkIndex,
        },
      });

      globalChunkIndex++;
    }
  }

  return allChunks;
}

/**
 * Splits `text` into overlapping windows of approximately `size` characters.
 *
 * Step between window starts = size - overlap, so adjacent windows share
 * `overlap` characters of text.  Each window boundary is snapped to the
 * nearest whitespace to avoid splitting a word in the middle.
 *
 * @param text    Source text.
 * @param size    Target window length in characters (default: CHUNK_SIZE).
 * @param overlap Shared tail / head length between windows (default: CHUNK_OVERLAP).
 */
export function splitWithOverlap(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  if (text.length <= size) return [text];

  const step = size - overlap;
  const windows: string[] = [];
  let start = 0;

  while (start < text.length) {
    // Raw end of this window
    let end = start + size;

    if (end < text.length) {
      // Advance end to the next whitespace so we don't split mid-word.
      const nextSpace = text.indexOf(" ", end);
      end = nextSpace !== -1 ? nextSpace : text.length;
    } else {
      end = text.length;
    }

    windows.push(text.slice(start, end));

    // Advance start by `step`, again aligning to whitespace.
    const rawNext = start + step;
    if (rawNext >= text.length) break;
    const nextStart = text.indexOf(" ", rawNext);
    start = nextStart !== -1 ? nextStart + 1 : text.length;
  }

  return windows;
}
