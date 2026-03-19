/**
 * types/chat.ts — conversation and session primitives.
 *
 * These are the core domain objects shared by the server-side session store
 * and the client-side state machine. They contain no UI state and no
 * implementation detail — only pure data shapes.
 */

// ── Message ───────────────────────────────────────────────────────────────────

/**
 * The role of a participant in a conversation turn.
 *
 * "system"    — injected by the server (system prompt, policy context)
 * "user"      — the employee's question
 * "assistant" — the model's response
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * A single immutable message in a conversation.
 * This is the server-canonical shape — stored in the session store,
 * passed to the LLM as conversation history, and sent to the client.
 */
export interface ChatMessage {
  /** UUID v4 — unique within the session */
  id: string;
  role: MessageRole;
  /** Plain text content — never HTML */
  content: string;
  /** Wall-clock time the message was created on the server */
  createdAt: Date;
}

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * Server-side session record.
 * Stored in the in-memory session Map; the full shape is never sent to the client.
 * Only the sessionId is returned to the client in the metadata chunk.
 */
export interface SessionState {
  /** UUID v4 generated server-side on first request */
  sessionId: string;
  /**
   * Ordered conversation history, trimmed to SESSION_MAX_TURNS × 2.
   * Odd indices are user messages; even are assistant replies.
   */
  messages: ChatMessage[];
  /** When this session was first created */
  createdAt: Date;
  /** Updated whenever appendToSession() is called */
  updatedAt: Date;
}

/**
 * Summary of a session for monitoring / health-check endpoints.
 * Contains no message content — safe to log.
 */
export interface SessionSummary {
  sessionId: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}
