/**
 * InputBar — message composition area.
 *
 * - Textarea auto-resizes from 1 to 4 rows as content grows
 * - Enter submits; Shift+Enter inserts a newline
 * - Disabled (with visual feedback) while the assistant is streaming
 * - Clears itself after a successful submit
 * - Character counter warns near the 2000-char server limit
 */

"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MAX_CHARS = 2000;
const WARN_AT   = 1800;

interface InputBarProps {
  onSubmit: (message: string) => void;
  isStreaming?: boolean;
}

export default function InputBar({
  onSubmit,
  isStreaming = false,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`; // max ~4 rows
  }, [value]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
    setValue("");
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const charsLeft = MAX_CHARS - value.length;
  const nearLimit  = value.length >= WARN_AT;
  const overLimit  = value.length > MAX_CHARS;
  const canSubmit  = value.trim().length > 0 && !isStreaming && !overLimit;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={[
          "flex items-end gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm transition-colors",
          overLimit
            ? "border-red-300 ring-1 ring-red-200"
            : isStreaming
            ? "border-slate-200 opacity-70"
            : "border-slate-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-200",
        ].join(" ")}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
          maxLength={MAX_CHARS + 1} // allow typing over to show error; server enforces hard limit
          placeholder={
            isStreaming ? "Waiting for response…" : "Ask about a company policy…"
          }
          aria-label="Message input"
          className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-slate-800 placeholder-slate-400 outline-none disabled:cursor-not-allowed"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Send message"
          className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isStreaming ? (
            /* Spinner */
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            /* Arrow-up icon */
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M6 10V2M2 6l4-4 4 4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Character counter — only visible near the limit */}
      {nearLimit && (
        <p
          className={`text-right text-[10px] ${
            overLimit ? "text-red-500" : "text-slate-400"
          }`}
        >
          {overLimit
            ? `${Math.abs(charsLeft)} characters over limit`
            : `${charsLeft} characters remaining`}
        </p>
      )}
    </div>
  );
}
