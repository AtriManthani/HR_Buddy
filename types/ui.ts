/**
 * types/ui.ts — client-side state machine and display types.
 *
 * These types live exclusively in the browser — never imported by server-side
 * modules. They describe the React state managed by useChatState / chatReducer
 * and the display shape used by ChatWindow / AssistantResponse.
 */

import type { Citation, Recommendation } from "./citations";
import type { StructuredResponse }        from "./response";

// ── Display message ────────────────────────────────────────────────────────────

/**
 * A message as it appears in the chat UI.
 *
 * Extends the minimal { id, role, content, createdAt } shape with
 * frontend-only fields that track streaming state and attached metadata.
 * Never serialized or persisted — lives only in React state.
 */
export interface DisplayMessage {
  id: string;
  /** UI only renders user and assistant messages (system messages are hidden) */
  role: "user" | "assistant";
  /** Accumulated text content — appended token-by-token while isStreaming */
  content: string;
  createdAt: Date;
  /** Citations populated when the metadata chunk arrives at end of stream */
  citations?: Citation[];
  /** Recommendations populated when the metadata chunk arrives; empty array means none */
  recommendations?: Recommendation[];
  /**
   * Full structured breakdown of the response.
   * Populated from the metadata chunk; absent while streaming.
   * When absent the UI falls back to rendering content as plain prose.
   */
  structuredResponse?: StructuredResponse;
  /** True while the server is still streaming tokens for this message */
  isStreaming?: boolean;
}

// ── Chat status ────────────────────────────────────────────────────────────────

/**
 * Lifecycle status of the chat session, used to drive UI state.
 *
 *   idle      — ready to accept a new message; input is enabled
 *   loading   — request sent, waiting for the first token; spinner shown
 *   streaming — tokens are arriving; send button disabled, cursor blinks
 *   error     — last request failed; error banner shown, retry available
 */
export type ChatStatus = "idle" | "loading" | "streaming" | "error";

// ── Chat state ────────────────────────────────────────────────────────────────

/**
 * The complete, serializable state of one chat session.
 * Owned by the chatReducer via useReducer inside useChatState.
 */
export interface ChatState {
  messages: DisplayMessage[];
  /** Server-assigned session UUID; null until the first response arrives */
  sessionId: string | null;
  status: ChatStatus;
  /** Error message to display in the error banner; null when no error */
  error: string | null;
  /** Last user message text — stored for one-click retry on error */
  lastUserMessage: string | null;
}

// ── Hook actions ──────────────────────────────────────────────────────────────

/**
 * The callable interface returned by useChatState alongside ChatState.
 *
 * All methods are stable references (useCallback) — safe to pass as props
 * or include in dependency arrays without triggering re-renders.
 */
export interface ChatActions {
  /** Submits a new user message. No-op if the session is already loading/streaming. */
  submitMessage: (text: string) => Promise<void>;
  /** Re-submits the last user message. No-op if lastUserMessage is null. */
  retryLast: () => Promise<void>;
  /** Resets the in-memory chat state and clears the persisted session ID. */
  clearChat: () => void;
  /** Clears the error banner and returns status to "idle". */
  dismissError: () => void;
}
