/**
 * Sidebar — left panel with policy categories and suggested questions.
 *
 * Responsive behaviour:
 *   Desktop (md+): always visible, fixed left column.
 *   Mobile (<md):  hidden by default; slides in as a drawer overlay when
 *                  isOpen is true. A dark backdrop closes it on tap.
 *
 * No external links, no action triggers — purely informational navigation.
 */

"use client";

import { useState } from "react";

// ── Static data ───────────────────────────────────────────────────────────────

const POLICY_CATEGORIES = [
  { id: "leave",        label: "Leave & Time Off",      icon: "🏖" },
  { id: "benefits",     label: "Health & Benefits",     icon: "🏥" },
  { id: "conduct",      label: "Code of Conduct",       icon: "📋" },
  { id: "compensation", label: "Compensation & Pay",    icon: "💰" },
  { id: "performance",  label: "Performance",           icon: "📈" },
  { id: "remote",       label: "Remote Work",           icon: "🏠" },
  { id: "safety",       label: "Workplace Safety",      icon: "🛡" },
  { id: "learning",     label: "Learning & Development", icon: "🎓" },
];

const SUGGESTED_QUESTIONS = [
  "How many days of annual leave am I entitled to?",
  "What is the sick leave policy?",
  "How does the performance review process work?",
  "What are the remote working guidelines?",
  "What benefits am I eligible for?",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  onSelectQuestion: (question: string) => void;
  /** Whether the mobile drawer is open (irrelevant on desktop) */
  isOpen?: boolean;
  /** Called when the user dismisses the mobile drawer */
  onClose?: () => void;
}

// ── Inner content (shared between mobile drawer and desktop panel) ────────────

function SidebarContent({
  onSelectQuestion,
  onClose,
}: {
  onSelectQuestion: (q: string) => void;
  onClose?: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const handleSelect = (q: string) => {
    onSelectQuestion(q);
    onClose?.(); // close drawer on mobile after selection
  };

  return (
    <>
      {/* Scrollable content */}
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4 scrollbar-thin">

        {/* Policy categories */}
        <section aria-label="Policy categories">
          <h2 className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Policy Categories
          </h2>
          <nav>
            <ul className="space-y-0.5" role="list">
              {POLICY_CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                return (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => setActiveCategory(isActive ? null : cat.id)}
                      className={[
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors",
                        isActive
                          ? "border-l-2 border-brand-500 bg-brand-50 pl-2 text-brand-700"
                          : "border-l-2 border-transparent text-slate-600 hover:bg-white hover:text-slate-900",
                      ].join(" ")}
                      aria-pressed={isActive}
                    >
                      <span className="shrink-0 text-base leading-none" aria-hidden="true">
                        {cat.icon}
                      </span>
                      <span className="truncate">{cat.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </section>

        {/* Suggested questions */}
        <section aria-label="Suggested questions">
          <h2 className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Try Asking
          </h2>
          <ul className="space-y-1.5" role="list">
            {SUGGESTED_QUESTIONS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => handleSelect(q)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span className="line-clamp-2">{q}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Footer disclaimer */}
      <div className="shrink-0 border-t border-slate-100 px-4 py-3">
        <p className="text-[10px] leading-relaxed text-slate-400">
          Answers are sourced from official HR documents only. This assistant
          cannot take actions or submit requests on your behalf.
        </p>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Sidebar({ onSelectQuestion, isOpen = false, onClose }: SidebarProps) {
  return (
    <>
      {/* ── Desktop: static left column ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-100 bg-slate-50 md:flex">
        <SidebarContent onSelectQuestion={onSelectQuestion} />
      </aside>

      {/* ── Mobile: overlay drawer ── */}
      <div className="md:hidden" aria-hidden={!isOpen}>
        {/* Backdrop */}
        <div
          className={[
            "fixed inset-0 z-40 bg-slate-900/40 transition-opacity duration-200",
            isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
          onClick={onClose}
          aria-label="Close navigation"
        />

        {/* Drawer panel */}
        <aside
          className={[
            "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-100 bg-slate-50 shadow-xl",
            "transition-transform duration-200 ease-out",
            isOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
          aria-label="Navigation"
        >
          <SidebarContent onSelectQuestion={onSelectQuestion} onClose={onClose} />
        </aside>
      </div>
    </>
  );
}
