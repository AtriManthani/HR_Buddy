/**
 * MessageBubble — routes a single conversation turn to the correct renderer.
 *
 * User messages: right-aligned dark chip.
 * Assistant messages: delegated to AssistantResponse.
 */

import type { DisplayMessage } from "@/types";
import AssistantResponse from "./AssistantResponse";

interface MessageBubbleProps {
  message: DisplayMessage;
}

function AssistantAvatar() {
  return (
    <div
      aria-hidden="true"
      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[9px] font-bold tracking-tight text-white shadow-sm ring-2 ring-white"
    >
      HR
    </div>
  );
}

export default function MessageBubble({ message }: MessageBubbleProps) {

  // ── User message ────────────────────────────────────────────────────────────

  if (message.role === "user") {
    return (
      <div className="flex animate-fade-in justify-end py-1.5">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[72%]">
          {message.content}
        </div>
      </div>
    );
  }

  // ── Assistant message ───────────────────────────────────────────────────────

  return (
    <div className="flex animate-fade-in items-start gap-2.5 py-1.5">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <AssistantResponse
          content={message.content}
          isStreaming={message.isStreaming ?? false}
          citations={message.citations}
          recommendations={message.recommendations}
          structuredResponse={message.structuredResponse}
        />
      </div>
    </div>
  );
}
