/**
 * lib/chat/chatReducer.ts — pure reducer + action types for chat state.
 *
 * All state transitions are defined here as a discriminated union of actions.
 * The reducer is a pure function: same inputs always produce the same output,
 * no side effects, easy to unit test.
 *
 * Action flow for a normal conversation turn:
 *
 *   SUBMIT_USER_MESSAGE        → appends user message, sets status:"loading"
 *   ADD_ASSISTANT_PLACEHOLDER  → appends empty streaming message
 *   APPEND_TOKEN (× N)         → accumulates streamed tokens, status:"streaming"
 *   FINALIZE_ASSISTANT         → attaches citations/recommendation, status:"idle"
 *
 * Error path:
 *   SET_ERROR                  → removes streaming placeholder, status:"error"
 *
 * Reset path:
 *   CLEAR_CHAT                 → returns to initialChatState
 */

import type {
  ChatState,
  DisplayMessage,
  Citation,
  Recommendation,
  StructuredResponse,
} from "@/types";

// ── Action types ──────────────────────────────────────────────────────────────

export type ChatAction =
  | {
      type: "SUBMIT_USER_MESSAGE";
      payload: { id: string; content: string };
    }
  | {
      type: "ADD_ASSISTANT_PLACEHOLDER";
      payload: { id: string };
    }
  | {
      type: "APPEND_TOKEN";
      payload: { id: string; token: string };
    }
  | {
      type: "FINALIZE_ASSISTANT";
      payload: {
        id: string;
        citations?: Citation[];
        recommendations?: Recommendation[];
        structuredResponse?: StructuredResponse;
      };
    }
  | { type: "SET_SESSION_ID"; payload: string }
  | { type: "SET_ERROR";      payload: string }
  | { type: "DISMISS_ERROR" }
  | { type: "CLEAR_CHAT" };

// ── Initial state ─────────────────────────────────────────────────────────────

export const initialChatState: ChatState = {
  messages:        [],
  sessionId:       null,
  status:          "idle",
  error:           null,
  lastUserMessage: null,
};

// ── Reducer ───────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {

    case "SUBMIT_USER_MESSAGE": {
      const userMsg: DisplayMessage = {
        id:        action.payload.id,
        role:      "user",
        content:   action.payload.content,
        createdAt: new Date(),
      };
      return {
        ...state,
        messages:        [...state.messages, userMsg],
        status:          "loading",
        error:           null,
        lastUserMessage: action.payload.content,
      };
    }

    case "ADD_ASSISTANT_PLACEHOLDER": {
      const placeholder: DisplayMessage = {
        id:          action.payload.id,
        role:        "assistant",
        content:     "",
        createdAt:   new Date(),
        isStreaming: true,
      };
      return {
        ...state,
        messages: [...state.messages, placeholder],
        // status stays "loading" until the first token arrives
      };
    }

    case "APPEND_TOKEN": {
      return {
        ...state,
        status: "streaming",
        messages: state.messages.map((m) =>
          m.id === action.payload.id
            ? { ...m, content: m.content + action.payload.token }
            : m
        ),
      };
    }

    case "FINALIZE_ASSISTANT": {
      // Guard: if already finalized (e.g. called twice), skip
      const target = state.messages.find((m) => m.id === action.payload.id);
      if (target && !target.isStreaming) return state;

      return {
        ...state,
        status: "idle",
        messages: state.messages.map((m) =>
          m.id === action.payload.id
            ? {
                ...m,
                isStreaming:       false,
                citations:         action.payload.citations,
                recommendations:   action.payload.recommendations,
                structuredResponse: action.payload.structuredResponse,
              }
            : m
        ),
      };
    }

    case "SET_SESSION_ID": {
      return { ...state, sessionId: action.payload };
    }

    case "SET_ERROR": {
      // Drop any unfinished assistant placeholder before showing the error
      const messages = state.messages.filter(
        (m) => !(m.role === "assistant" && m.isStreaming)
      );
      return { ...state, status: "error", error: action.payload, messages };
    }

    case "DISMISS_ERROR": {
      return { ...state, status: "idle", error: null };
    }

    case "CLEAR_CHAT": {
      // Preserve the sessionId so the backend can still link the new conversation
      return { ...initialChatState, sessionId: state.sessionId };
    }

    default:
      return state;
  }
}
