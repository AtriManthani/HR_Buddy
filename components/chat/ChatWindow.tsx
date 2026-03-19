/**
 * ChatWindow — pure render component for the chat UI.
 *
 * Responsible for:
 *   - Calling useChatState() and passing results to children
 *   - Auto-scrolling to the latest message
 *   - Rendering the empty / message-list / error states
 *   - Exposing clearChat imperatively via forwarded ref (for Header)
 *   - Consuming the Sidebar trigger (auto-submitting suggested questions)
 */

"use client";

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useChatState } from "@/lib/chat/useChatState";
import MessageBubble from "./MessageBubble";
import InputBar from "./InputBar";
import EmptyState from "./EmptyState";
import ErrorBanner from "@/components/ui/ErrorBanner";

// ── Public handle ─────────────────────────────────────────────────────────────

export interface ChatWindowHandle {
  clearChat: () => void;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatWindowProps {
  triggerMessage?: string | null;
  onTriggerConsumed?: () => void;
}

// ── Loading bar ────────────────────────────────────────────────────────────────

/** Thin progress bar at the top of the message area during loading. */
function TopLoadingBar({ visible }: { visible: boolean }) {
  return (
    <div
      className={[
        "absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      ].join(" ")}
      aria-hidden="true"
    >
      <div className="h-full w-full shimmer" />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const ChatWindow = forwardRef<ChatWindowHandle, ChatWindowProps>(
  function ChatWindow({ triggerMessage, onTriggerConsumed }, ref) {
    const { state, submitMessage, retryLast, clearChat, dismissError } =
      useChatState();

    const { messages, status, error } = state;
    const isLoading   = status === "loading";
    const isStreaming = status === "loading" || status === "streaming";

    // ── Imperative handle ─────────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({ clearChat }), [clearChat]);

    // ── Auto-scroll to bottom ─────────────────────────────────────────────────

    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Sidebar trigger ───────────────────────────────────────────────────────

    useEffect(() => {
      if (triggerMessage) {
        submitMessage(triggerMessage);
        onTriggerConsumed?.();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerMessage]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
      <div className="relative flex flex-1 flex-col overflow-hidden bg-white">

        {/* Top loading bar — appears immediately when waiting for first token */}
        <TopLoadingBar visible={isLoading} />

        {/* Message list */}
        <div className="flex flex-1 flex-col overflow-y-auto scrollbar-thin">
          {messages.length === 0 ? (
            <EmptyState
              onSelectQuestion={submitMessage}
              hasSession={state.sessionId !== null}
            />
          ) : (
            <div className="mx-auto w-full max-w-2xl px-4 py-6">
              <div className="space-y-1">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>

              {/* Error banner — shown inline after the last message */}
              {error && (
                <div className="animate-fade-in pt-3">
                  <ErrorBanner
                    message={error}
                    onDismiss={dismissError}
                    onRetry={retryLast}
                  />
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
          <div className="mx-auto max-w-2xl">
            <InputBar onSubmit={submitMessage} isStreaming={isStreaming} />
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              Informational only · Cannot submit requests or take actions
            </p>
          </div>
        </div>
      </div>
    );
  }
);

export default ChatWindow;
