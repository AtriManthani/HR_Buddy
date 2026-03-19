/**
 * lib/api/responseBuilder.ts — NDJSON streaming response factory.
 *
 * Provides:
 *   createNdJsonStream(handler) — wraps an async pipeline in a ReadableStream,
 *     ensures the stream is always closed, and catches unhandled errors by
 *     writing a final error chunk before closing.
 *
 *   writeToken / writeMetadata / writeError — typed helpers so callers never
 *     construct raw StreamChunk objects — enforces the wire contract.
 *
 * Wire format: newline-delimited JSON (NDJSON / JSON Lines).
 *   Each line is one JSON-serialised StreamChunk, terminated with "\n".
 *   The client splits on "\n" and parses each line independently.
 *
 * Response headers:
 *   Content-Type: application/x-ndjson
 *   Cache-Control: no-cache, no-store   ← prevents proxy caching of partial streams
 *   X-Content-Type-Options: nosniff
 */

import type {
  StreamChunk,
  Citation,
  Recommendation,
  StructuredResponse,
} from "@/types";


// ── Types ─────────────────────────────────────────────────────────────────────

/** The write function passed into the stream handler. */
export type ChunkWriter = (chunk: StreamChunk) => void;

/** The async handler that drives the stream. Receives a writer and runs the pipeline. */
export type StreamHandler = (write: ChunkWriter) => Promise<void>;

// ── Core factory ──────────────────────────────────────────────────────────────

/**
 * Creates an NDJSON streaming HTTP response.
 *
 * Usage:
 *   return createNdJsonStream(async (write) => {
 *     write(writeToken("Hello "));
 *     write(writeToken("world"));
 *     write(writeMetadata({ sessionId, citations, recommendation, structuredResponse }));
 *   });
 *
 * @param handler - Async function that writes chunks via the provided writer
 */
export function createNdJsonStream(handler: StreamHandler): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    async start(controller) {
      const write: ChunkWriter = (chunk) => {
        controller.enqueue(
          encoder.encode(JSON.stringify(chunk) + "\n")
        );
      };

      try {
        await handler(write);
      } catch (err) {
        // Log the real error server-side for debugging, but never send
        // internal error details to the client — they may contain stack
        // traces, file paths, API keys, or other sensitive information.
        console.error("[stream] Unhandled pipeline error:", err);
        try {
          write({
            type:  "error",
            error: "The assistant encountered an unexpected error. Please try again.",
          });
        } catch {
          // Controller may already be closed — safe to ignore
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":           "application/x-ndjson",
      "Cache-Control":          "no-cache, no-store",
      "Transfer-Encoding":      "chunked",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ── Typed chunk builders ──────────────────────────────────────────────────────

/** Builds a token chunk. */
export function tokenChunk(token: string): StreamChunk {
  return { type: "token", token };
}

/** Builds the final metadata chunk. */
export function metadataChunk(payload: {
  sessionId: string;
  citations: Citation[];
  recommendations: Recommendation[];
  structuredResponse: StructuredResponse;
}): StreamChunk {
  return { type: "metadata", ...payload };
}

/** Builds an error chunk. */
export function errorChunk(message: string): StreamChunk {
  return { type: "error", error: message };
}

// ── Utility: stream a plain string as tokens ──────────────────────────────────

/**
 * Streams a complete string word-by-word into the write function.
 * Used for placeholder responses and refusal messages during development.
 *
 * In production this is replaced by real token streaming from the OpenAI SDK.
 */
export async function streamText(
  text: string,
  write: ChunkWriter,
  delayMs = 0
): Promise<void> {
  const tokens = text.match(/\S+\s*/g) ?? [];
  for (const token of tokens) {
    write(tokenChunk(token));
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
