/**
 * lib/rag/pipeline.ts — retrieval pipeline for the HR policy chatbot.
 *
 * This is the single entry point that app/api/chat/route.ts calls to go from
 * a raw user question to everything needed to build a grounded LLM response.
 *
 * Exported functions (in order of use):
 * ─────────────────────────────────────
 * retrieveRelevantChunks(question, options?)
 *   Embeds the question and retrieves the most similar policy chunks.
 *   Returns a RetrievalResult that includes the chunks AND a `hasContext` flag
 *   so the route can handle the "no matching policy" case before calling the LLM.
 *
 * formatContextForPrompt(chunks)
 *   Formats the retrieved chunks into a structured [POLICY CONTEXT] block that
 *   is injected into the LLM's user message.  The format is optimised for
 *   GPT-4o-mini: numbered excerpts, explicit source attribution, clear
 *   instructions that the model must answer only from these excerpts.
 *
 * buildCitationObjects(chunks)
 *   Converts RetrievedChunk[] into the Citation[] that is sent to the frontend
 *   alongside the streamed answer.  Deduplicates by (sourceFile, section) and
 *   truncates chunk text to a short readable excerpt.
 *
 * Guardrail: answers from retrieved content only
 * ─────────────────────────────────────────────
 * When retrieveRelevantChunks returns hasContext: false (no chunks above the
 * minimum score threshold), the route MUST NOT call the LLM.  Instead it
 * returns the standard "no policy found" message.  This is enforced by design:
 * the route receives hasContext and branches before LLM invocation.
 *
 * Dependency chain:
 *   pipeline.ts
 *     → lib/rag/embeddings.ts   (embedQuery)
 *     → lib/rag/vectorStore.ts  (initVectorStore)
 *     → lib/rag/retriever.ts    (retrieveChunks)
 *     → lib/utils/citations.ts  (formatCitations)
 */

import { embedQuery }       from "./embeddings";
import { initVectorStore }  from "./vectorStore";
import { retrieveChunks, type RetrieveOptions } from "./retriever";
import { formatCitations }  from "@/lib/utils/citations";

import type { RetrievedChunk, Citation } from "@/types";

// ── Result types ───────────────────────────────────────────────────────────────

export interface RetrievalResult {
  /** Ordered chunks (score descending). Empty when hasContext is false. */
  chunks: RetrievedChunk[];
  /**
   * True if at least one chunk exceeded the minimum similarity threshold.
   * When false, the route must NOT call the LLM — it should return the
   * standard "no policy found" message to prevent hallucination.
   */
  hasContext: boolean;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Embeds `question` and retrieves the most relevant policy chunks from the
 * in-memory vector store.
 *
 * Initialises the vector store on first call (no-op on subsequent calls).
 * This keeps the route handler free of store lifecycle management.
 *
 * @param question  The user's raw question (already sanitised by the route).
 * @param options   Optional overrides for topK, minScore, maxPerDoc.
 */
export async function retrieveRelevantChunks(
  question: string,
  options?: RetrieveOptions & { topK?: number }
): Promise<RetrievalResult> {
  // Ensure the store is loaded.  Safe to call on every request — the init
  // function is idempotent (no-op once the store is populated).
  await initVectorStore();

  const embedding = await embedQuery(question);
  const chunks    = retrieveChunks(embedding, options?.topK, options);

  return {
    chunks,
    hasContext: chunks.length > 0,
  };
}

/**
 * Formats retrieved chunks into a structured context block for the LLM.
 *
 * The block is designed to:
 *   1. Be unambiguous about the source of each excerpt.
 *   2. Explicitly instruct the model to answer only from the excerpts.
 *   3. Include all metadata that helps the model attribute its answer
 *      (policy title, section, page number, category).
 *
 * When no chunks are provided, returns a context block that tells the model
 * explicitly that no relevant policy was found — ensuring the model can
 * produce a correct "I don't know" response rather than hallucinating.
 *
 * @param chunks — RetrievedChunk[] from retrieveRelevantChunks().
 */
export function formatContextForPrompt(chunks: RetrievedChunk[]): string {
  const header =
    "[POLICY CONTEXT]\n" +
    "The following excerpts are from official HR policy documents.\n" +
    "Base your answer on these excerpts. You may:\n" +
    "  - Quote or paraphrase text from the excerpts as confirmed policy facts\n" +
    "  - Apply the rules logically to the user's specific scenario\n" +
    "  - Synthesise information across multiple excerpts into a single answer\n" +
    "  - Draw logical conclusions from stated rules (inference from facts is allowed)\n" +
    "You must NOT state facts, numbers, or entitlements not present in these excerpts.";

  if (chunks.length === 0) {
    return (
      header +
      "\n\nNo relevant policy documents were found for this question.\n" +
      "You MUST respond: \"I couldn't find information about that in the " +
      "current policy documents. Please contact HR directly for assistance.\""
    );
  }

  const excerpts = chunks
    .map((chunk, i) => formatSingleExcerpt(chunk, i + 1, chunks.length))
    .join("\n\n");

  return `${header}\n\n${excerpts}`;
}

/**
 * Converts retrieved chunks into Citation objects for the API response.
 *
 * Citations are sent to the frontend in the metadata chunk alongside every
 * assistant turn.  They are rendered as collapsible source cards so users
 * can verify every answer against the original policy document.
 *
 * Deduplicates by (sourceFile, section): if two overlapping windows from the
 * same section were retrieved, only the higher-scoring one is shown.
 *
 * @param chunks — RetrievedChunk[] from retrieveRelevantChunks().
 */
export function buildCitationObjects(chunks: RetrievedChunk[]): Citation[] {
  // Delegate to the shared citation formatter which handles deduplication
  // and excerpt truncation.
  return formatCitations(chunks);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Formats a single chunk into a numbered excerpt block for the LLM context.
 *
 * Example output:
 *   ── Excerpt 2 of 5 ──────────────────────────
 *   Document:  VACATION LEAVE POLICY
 *   Section:   I. Vacation Leave
 *   File:      Vacation-Policy-2023-11-15.pdf  |  Page 1  |  Leave & Benefits
 *
 *   I. Vacation Leave
 *
 *   A. All regular full-time City officers or employees, including…
 */
function formatSingleExcerpt(
  chunk: RetrievedChunk,
  index: number,
  total: number
): string {
  const { metadata, text } = chunk;

  // Build the source header line
  const fileInfo = [
    metadata.sourceFile,
    metadata.pageOrLine != null ? `Page ${metadata.pageOrLine}` : null,
    metadata.policyCategory ?? null,
  ]
    .filter(Boolean)
    .join("  |  ");

  const lines: string[] = [
    `── Excerpt ${index} of ${total} ${"─".repeat(Math.max(0, 44 - String(index).length - String(total).length))}`,
    `Document:  ${metadata.policyTitle}`,
  ];

  if (metadata.section && metadata.section !== metadata.policyTitle) {
    lines.push(`Section:   ${metadata.section}`);
  }

  lines.push(`File:      ${fileInfo}`);
  lines.push("");           // blank line before body
  lines.push(text.trim());  // the actual chunk text

  return lines.join("\n");
}
