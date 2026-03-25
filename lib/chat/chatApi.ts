/**
 * lib/chat/chatApi.ts — API transport layer for the chat feature.
 *
 * Exports a single async generator: sendMessage()
 * It yields StreamChunk objects that the useChatState hook consumes.
 *
 * Sends a POST to /api/chat and parses the NDJSON ReadableStream response,
 * yielding TokenChunk, MetadataChunk, and ErrorChunk events as they arrive.
 *
 * Public contract:
 *   sendMessage(message, sessionId) → AsyncGenerator<StreamChunk>
 */

import type { StreamChunk } from "@/types";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends a user message to POST /api/chat and yields StreamChunk events
 * as they arrive over the NDJSON stream.
 *
 * @param message   - The user's question text
 * @param sessionId - Existing session UUID, or null for a new session
 */
export async function* sendMessage(
  message:   string,
  sessionId: string | null
): AsyncGenerator<StreamChunk> {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message, sessionId }),
    });
  } catch {
    yield { type: "error", error: "Could not reach the server. Please check your connection and try again." };
    return;
  }

  // Non-streaming error (e.g. 400 validation error, 500 before stream opens)
  if (!response.ok || !response.body) {
    let detail = "";
    try {
      const json = await response.json() as { error?: string };
      detail = json.error ? ` — ${json.error}` : "";
    } catch { /* ignore parse errors */ }
    yield { type: "error", error: `Request failed (${response.status})${detail}. Please try again.` };
    return;
  }

  // Parse the NDJSON ReadableStream line by line
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Each complete NDJSON line ends with \n
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) fragment in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(trimmed) as StreamChunk;
        } catch {
          // Malformed line — skip and continue
          continue;
        }

        yield chunk;
      }
    }

    // Flush any remaining buffer content after the stream closes
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as StreamChunk;
      } catch { /* ignore */ }
    }
  } finally {
    reader.cancel().catch(() => { /* ignore */ });
  }
}
