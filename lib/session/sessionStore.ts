/**
 * Session store — short-term in-memory conversation memory.
 *
 * Stores the last N message pairs per session so the LLM sees prior context.
 *
 * Storage: module-level Map<string, SessionState>.
 *   Works for single-instance Node.js server processes.
 *   For multi-instance / persistence across restarts, swap the Map internals
 *   for Upstash Redis or any key-value store — the public API stays identical.
 *
 * Session ID: UUID v4 generated server-side on first request, returned to the
 *   client in the metadata chunk, echoed back in subsequent requests.
 *   No cookies are used (avoids CSRF surface area).
 *
 * Privacy: sessions are never written to disk. They expire when the server
 *   process recycles. No PII is logged.
 */

import type { SessionState, ChatMessage } from "@/types";
import { env } from "@/lib/config/env";

// Each "turn" = one user message + one assistant reply
const MAX_TURNS = env.SESSION_MAX_TURNS;
// Cap on absolute message count stored per session (2 × turns = pairs)
const MAX_MESSAGES = MAX_TURNS * 2;

/** In-memory store — module-level singleton */
const sessions = new Map<string, SessionState>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieves an existing session by ID, or creates a new one.
 *
 * @param sessionId - UUID from the client request body, or null on first visit
 * @returns         - The resolved SessionState and the definitive sessionId
 */
export function getOrCreateSession(
  sessionId: string | null
): { session: SessionState; sessionId: string } {
  if (sessionId && sessions.has(sessionId)) {
    return { session: sessions.get(sessionId)!, sessionId };
  }

  const newId = crypto.randomUUID();
  const session: SessionState = {
    sessionId:  newId,
    messages:   [],
    createdAt:  new Date(),
    updatedAt:  new Date(),
  };
  sessions.set(newId, session);
  return { session, sessionId: newId };
}

/**
 * Appends a completed user + assistant message pair to the session.
 * Automatically trims history to the most recent MAX_TURNS pairs.
 *
 * Called AFTER the streaming response completes (so the assistant content
 * is the full, final text — not a partial stream).
 *
 * @param sessionId        - Session to update
 * @param userMessage      - The user's question
 * @param assistantMessage - The assistant's complete response text
 */
export function appendToSession(
  sessionId:        string,
  userMessage:      ChatMessage,
  assistantMessage: ChatMessage
): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.messages.push(userMessage, assistantMessage);

  // Keep only the most recent MAX_MESSAGES entries
  if (session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(-MAX_MESSAGES);
  }

  session.updatedAt = new Date();
}

/**
 * Returns the conversation history for a session.
 * Used to build the LLM prompt — already trimmed to MAX_MESSAGES.
 * Returns [] for unknown session IDs.
 */
export function getHistory(sessionId: string): ChatMessage[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.messages.slice(-MAX_MESSAGES);
}

/**
 * Removes all messages for a session.
 * Called when the user starts a "New Chat".
 */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Returns the number of active sessions (for health checks / monitoring). */
export function getSessionCount(): number {
  return sessions.size;
}
