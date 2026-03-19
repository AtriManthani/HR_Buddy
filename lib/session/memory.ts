/**
 * lib/session/memory.ts — short-term conversation memory for the HR chatbot.
 *
 * Responsibility split
 * ────────────────────
 * This module owns conversation CONTENT: the sequence of ChatMessage objects
 * that form each session's short-term memory.
 *
 * lib/session/sessionStore.ts owns session LIFECYCLE: ID generation, creation
 * timestamps, active-session counts, and session invalidation.
 *
 * Keeping them separate means a Redis migration only touches this file —
 * the session ID machinery stays unchanged.
 *
 * Privacy guarantees
 * ──────────────────
 * • Messages are stored in-process only (no disk writes, no external calls).
 * • History is bounded by SESSION_MAX_TURNS — old messages are discarded as
 *   the conversation grows; they are never archived.
 * • The store lives in module scope; it is wiped when the server restarts.
 * • No names, email addresses, or identifiers are stored here explicitly —
 *   any PII in a message body is caught at the input-sanitisation layer
 *   (lib/security/sanitize.ts) before it reaches this store.
 *
 * Sliding window
 * ──────────────
 * Each turn = 1 user message + 1 assistant reply = 2 stored messages.
 * The window size is SESSION_MAX_TURNS × 2 (default 12 messages / 6 turns).
 * After every turn, trimSessionMemory() drops the oldest messages so the
 * window never exceeds that cap.  The LLM therefore always sees the most
 * recent context, never stale early-session messages.
 *
 * Redis migration guide
 * ─────────────────────
 * 1. Implement RedisMemoryBackend satisfying the MemoryBackend interface below.
 *    Each method maps to a single Redis command on a LIST keyed by sessionId:
 *      getMessages    → JSON.parse(await redis.lrange(key, 0, -1))
 *      appendMessage  → await redis.rpush(key, JSON.stringify(message))
 *      trimToWindow   → await redis.ltrim(key, -maxMessages, -1)
 *      clearMessages  → await redis.del(key)
 * 2. Add "redis" to the SupportedBackend union type.
 * 3. Add a case in getBackend() that creates your RedisMemoryBackend.
 * 4. Set MEMORY_BACKEND=redis in your environment variables.
 * 5. All callers (getSessionMemory, appendToSessionMemory, etc.) are unchanged.
 */

import type { ChatMessage } from "@/types";
import { env }              from "@/lib/config/env";

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Maximum number of messages stored per session.
 * Derived from SESSION_MAX_TURNS (env var, default 6):
 *   6 turns × 2 messages/turn = 12 messages max.
 *
 * This is the sliding window size.  trimSessionMemory() enforces it.
 */
const WINDOW_SIZE = env.SESSION_MAX_TURNS * 2;

// ── Backend interface ─────────────────────────────────────────────────────────

/**
 * All methods are async so the local (Map-backed) and remote (Redis-backed)
 * implementations share the same call signature.
 *
 * Local: methods resolve synchronously via Promise.resolve().
 * Redis: methods perform I/O and may reject on network errors — callers
 *        should handle errors appropriately (the route already wraps
 *        pipeline steps in try/catch).
 */
export interface MemoryBackend {
  /**
   * Returns all stored messages for a session, in chronological order.
   * Returns [] when the session has no history or does not exist.
   */
  getMessages(sessionId: string): Promise<ChatMessage[]>;

  /**
   * Appends a single message to the end of the session's history.
   * Creates the session entry if it does not already exist.
   */
  appendMessage(sessionId: string, message: ChatMessage): Promise<void>;

  /**
   * Trims the session history to the most recent `maxMessages` entries.
   * Entries beyond the window (oldest first) are discarded permanently.
   * No-op when the message count is already within the limit.
   */
  trimToWindow(sessionId: string, maxMessages: number): Promise<void>;

  /**
   * Removes all messages for a session.
   * Called when the user starts a new chat or the session is invalidated.
   */
  clearMessages(sessionId: string): Promise<void>;
}

// ── Local in-process backend ──────────────────────────────────────────────────

/**
 * In-process implementation backed by a module-level Map.
 *
 * Characteristics:
 *   • Zero latency — all operations are synchronous under the hood.
 *   • Zero persistence — wiped on server restart / function cold-start.
 *   • Suitable for dev, preview deployments, and single-container production.
 *   • Replace with RedisMemoryBackend for multi-instance or persistent memory.
 *
 * The Map key is the sessionId (UUID v4 assigned by sessionStore.ts).
 * Values are mutable arrays — we avoid unnecessary copies by operating in place.
 */
class LocalMemoryBackend implements MemoryBackend {
  private readonly store = new Map<string, ChatMessage[]>();

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    // Return a shallow copy so callers cannot mutate the store by reference.
    return [...(this.store.get(sessionId) ?? [])];
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const messages = this.store.get(sessionId) ?? [];
    messages.push(message);
    this.store.set(sessionId, messages);
  }

  async trimToWindow(sessionId: string, maxMessages: number): Promise<void> {
    const messages = this.store.get(sessionId);
    if (!messages || messages.length <= maxMessages) return;
    // slice(-n) keeps the last n elements — the most recent messages.
    this.store.set(sessionId, messages.slice(-maxMessages));
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  /** Returns the number of active session entries (for monitoring). */
  size(): number {
    return this.store.size;
  }
}

// ── Backend registry ──────────────────────────────────────────────────────────

/**
 * Extend this union when adding new backends (e.g. "redis" | "upstash").
 * The getBackend() factory must handle each value with a corresponding case.
 */
type SupportedBackend = "local";

/** Module-level singleton — initialised once, reused for all requests. */
let _backend: MemoryBackend | null = null;

/**
 * Returns the singleton MemoryBackend, creating it on first call.
 *
 * Reads MEMORY_BACKEND from process.env (not validated by env.ts because it
 * has a safe default and is not a secret).  This means the env var is read at
 * call time (first request), not at import time — dotenv will have run by then.
 */
function getBackend(): MemoryBackend {
  if (_backend) return _backend;

  const name = (process.env.MEMORY_BACKEND ?? "local") as SupportedBackend;

  switch (name) {
    case "local":
    default:
      if (name !== "local") {
        console.warn(
          `[memory] Unknown MEMORY_BACKEND "${name}" — falling back to "local".`
        );
      }
      _backend = new LocalMemoryBackend();
  }

  return _backend;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the recent conversation history for a session.
 *
 * Called at the start of each request to build the LLM messages array.
 * The returned array is safe to mutate — it is a copy of the stored slice.
 *
 * @param sessionId — UUID v4 from getOrCreateSession() in sessionStore.ts.
 * @returns ChatMessage[] ordered oldest → newest.  Empty array if no history.
 */
export async function getSessionMemory(
  sessionId: string
): Promise<ChatMessage[]> {
  return getBackend().getMessages(sessionId);
}

/**
 * Appends a single message to the session's conversation history.
 *
 * Call once per message (user message first, then assistant reply).
 * Follow with trimSessionMemory() after appending both messages of a turn
 * to enforce the sliding window.
 *
 * Silently no-ops for invalid sessionIds — the session ID is always valid
 * by the time persistTurn() runs (resolved in Step 5 of the pipeline).
 *
 * @param sessionId — UUID v4 from the pipeline context.
 * @param message   — Fully-formed ChatMessage with id, role, content, createdAt.
 */
export async function appendToSessionMemory(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  await getBackend().appendMessage(sessionId, message);
}

/**
 * Trims the session history to the most recent WINDOW_SIZE messages.
 *
 * Call this AFTER appending both messages of a completed turn (user +
 * assistant).  This keeps the sliding window consistent: the next call to
 * getSessionMemory() will always return at most WINDOW_SIZE messages.
 *
 * WINDOW_SIZE = SESSION_MAX_TURNS (default 6) × 2 = 12 messages.
 *
 * @param sessionId — Session to trim.
 */
export async function trimSessionMemory(sessionId: string): Promise<void> {
  await getBackend().trimToWindow(sessionId, WINDOW_SIZE);
}

/**
 * Removes all messages for a session.
 *
 * Call when the user explicitly starts a "New Chat" or when a session is
 * invalidated server-side.  Pair with sessionStore.clearSession() to fully
 * remove both the session metadata and its conversation history.
 *
 * @param sessionId — Session to clear.
 */
export async function clearSessionMemory(sessionId: string): Promise<void> {
  await getBackend().clearMessages(sessionId);
}

// ── Test utilities ────────────────────────────────────────────────────────────

/**
 * Resets the backend singleton.
 *
 * Intended for unit tests that need a fresh store between test cases.
 * Not for production use.
 *
 * @internal
 */
export function _resetMemoryBackend(): void {
  _backend = null;
}
