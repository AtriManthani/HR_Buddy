/**
 * ChatShell — top-level client orchestrator.
 *
 * Owns shared state that bridges Header, Sidebar, and ChatWindow:
 *   - sidebarOpen:    mobile drawer visibility
 *   - triggerMessage: question clicked in Sidebar, forwarded to ChatWindow
 *   - onNewChat:      resets the session via ChatWindow's imperative handle
 */

"use client";

import { useState, useRef } from "react";
import Header from "@/components/layout/Header";
import Sidebar from "@/components/layout/Sidebar";
import ChatWindow, { type ChatWindowHandle } from "@/components/chat/ChatWindow";

export default function ChatShell() {
  // Ref into ChatWindow so Header's "New Chat" can call clearChat()
  const chatRef = useRef<ChatWindowHandle>(null);

  // Mobile sidebar drawer
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // A question clicked in the Sidebar — forwarded to ChatWindow for auto-submit
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);

  const handleNewChat = () => {
    chatRef.current?.clearChat();
    setSidebarOpen(false);
  };

  const handleSelectQuestion = (question: string) => {
    setTriggerMessage(question);
  };

  const handleTriggerConsumed = () => {
    setTriggerMessage(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        onNewChat={handleNewChat}
        onMenuToggle={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onSelectQuestion={handleSelectQuestion}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <ChatWindow
          ref={chatRef}
          triggerMessage={triggerMessage}
          onTriggerConsumed={handleTriggerConsumed}
        />
      </div>
    </div>
  );
}
