/**
 * lib/chat/useChatState.ts — custom hook for chat session state management.
 *
 * Encapsulates all stateful chat logic behind a clean interface.
 * ChatWindow (and any future chat surface) calls this hook and receives
 * only what it needs to render — no raw dispatch, no internal reducer details.
 *
 * Features:
 * - useReducer with typed actions (see chatReducer.ts)
 * - sessionId persisted to sessionStorage (survives page refresh)
 * - retryLast: re-submits the last user message on error
 * - submitMessage is safe to call concurrently: debounced by status check
 * - cleanly separated from the API transport (chatApi.ts is the only import
 *   that touches network / stub logic)
 *
 * Phase 4 note:
 * When chatApi.ts is swapped from stub → real fetch, this hook needs
 * no changes. The state machine, session persistence, and error handling
 * all remain identical.
 */

"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import { chatReducer, initialChatState } from "@/lib/chat/chatReducer";
import { sendMessage } from "@/lib/chat/chatApi";
import type { ChatState, ChatActions } from "@/types";

const SESSION_STORAGE_KEY = "policyAgentSessionId";

export function useChatState(): { state: ChatState } & ChatActions {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);

  // ── Session persistence ───────────────────────────────────────────────────

  // Restore sessionId from sessionStorage on first mount
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) dispatch({ type: "SET_SESSION_ID", payload: saved });
  }, []);

  // Persist sessionId whenever it changes
  useEffect(() => {
    if (state.sessionId) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, state.sessionId);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [state.sessionId]);

  // ── Stable ref for state (avoids stale closures in callbacks) ────────────

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Core submit ───────────────────────────────────────────────────────────

  const submitMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Guard: only one request at a time
    const { status } = stateRef.current;
    if (status === "loading" || status === "streaming") return;

    const userId      = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    dispatch({ type: "SUBMIT_USER_MESSAGE",       payload: { id: userId, content: trimmed } });
    dispatch({ type: "ADD_ASSISTANT_PLACEHOLDER", payload: { id: assistantId } });

    let finalized = false;

    try {
      for await (const chunk of sendMessage(trimmed, stateRef.current.sessionId)) {
        if (chunk.type === "token" && chunk.token) {
          dispatch({ type: "APPEND_TOKEN", payload: { id: assistantId, token: chunk.token } });

        } else if (chunk.type === "metadata") {
          if (chunk.sessionId) {
            dispatch({ type: "SET_SESSION_ID", payload: chunk.sessionId });
          }
          dispatch({
            type: "FINALIZE_ASSISTANT",
            payload: {
              id:                 assistantId,
              citations:          chunk.citations,
              recommendations:    chunk.recommendations,
              structuredResponse: chunk.structuredResponse,
            },
          });
          finalized = true;

        } else if (chunk.type === "error") {
          throw new Error(chunk.error ?? "The assistant returned an error.");
        }
      }

      // Ensure we always finalize, even if the generator ended without metadata
      if (!finalized) {
        dispatch({ type: "FINALIZE_ASSISTANT", payload: { id: assistantId } });
      }

    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      dispatch({ type: "SET_ERROR", payload: message });
    }
  }, []); // stable: uses stateRef for current state, not captured state

  // ── Retry last message ────────────────────────────────────────────────────

  const retryLast = useCallback(async () => {
    const last = stateRef.current.lastUserMessage;
    if (last) await submitMessage(last);
  }, [submitMessage]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const clearChat = useCallback(() => {
    dispatch({ type: "CLEAR_CHAT" });
  }, []);

  const dismissError = useCallback(() => {
    dispatch({ type: "DISMISS_ERROR" });
  }, []);

  return { state, submitMessage, retryLast, clearChat, dismissError };
}
