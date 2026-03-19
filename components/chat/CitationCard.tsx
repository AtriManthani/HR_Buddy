/**
 * CitationCard — collapsible source chip.
 *
 * Collapsed state: compact chip showing index badge, policy title, section,
 * source file, page number, and a relevance score badge (dev-only).
 *
 * Expanded state: full document-coordinates panel slides open, showing:
 *   - Policy category badge
 *   - Structured metadata row (document · section · page)
 *   - Verbatim excerpt from the matched chunk
 *   - Cosine similarity score (dev-only)
 *
 * Design rules:
 * - Read-only: no action buttons, no external links, no email openers
 * - All metadata fields are optional and hidden gracefully when absent
 * - Relevance score only visible in NODE_ENV=development
 * - Excerpt is truncated to ≤ 300 chars by the API; shown verbatim here
 */

"use client";

import { useState } from "react";
import type { Citation } from "@/types";

interface CitationCardProps {
  citation: Citation;
  index: number;
}

// ── Category badge colours ─────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  "Leave & Benefits":    "bg-emerald-50  text-emerald-700  ring-emerald-200",
  "Workplace Safety":    "bg-amber-50    text-amber-700    ring-amber-200",
  "Ethics & Compliance": "bg-violet-50   text-violet-700   ring-violet-200",
  "General HR Policy":   "bg-slate-50    text-slate-600    ring-slate-200",
};

function categoryStyle(category: string | undefined): string {
  if (!category) return CATEGORY_STYLES["General HR Policy"];
  return CATEGORY_STYLES[category] ?? CATEGORY_STYLES["General HR Policy"];
}

// ── Metadata pill ─────────────────────────────────────────────────────────────

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-600">{value}</span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CitationCard({ citation, index }: CitationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-xs shadow-sm transition-shadow hover:shadow">

      {/* ── Chip row — always visible ─────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={[
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500",
          expanded
            ? "rounded-t-xl bg-brand-50"
            : "rounded-xl hover:bg-slate-50",
        ].join(" ")}
      >
        {/* Index badge */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-700 ring-1 ring-brand-200">
          {index}
        </span>

        {/* Title + section */}
        <div className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-slate-700">{citation.policyTitle}</span>
          {citation.section && (
            <span className="ml-1.5 truncate text-slate-400">· {citation.section}</span>
          )}
        </div>

        {/* Right side: source + page + score + chevron */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden truncate text-slate-400 sm:inline">
            {citation.sourceFile}
            {citation.pageOrLine !== undefined && (
              <span> · p.{citation.pageOrLine}</span>
            )}
          </span>

          {isDev && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-slate-500">
              {(citation.score * 100).toFixed(0)}%
            </span>
          )}

          {/* Expand/collapse chevron */}
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${
              expanded ? "rotate-180 text-brand-500" : ""
            }`}
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>

      {/* ── Expanded panel ────────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-brand-100 bg-white px-4 py-3 space-y-3">

          {/* Document coordinates row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Category badge — shown when available */}
            {citation.policyCategory && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${categoryStyle(citation.policyCategory)}`}
              >
                {citation.policyCategory}
              </span>
            )}

            {/* Structured metadata pills */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              <MetaPill label="Document" value={citation.sourceFile} />
              {citation.section && (
                <>
                  <span className="text-slate-200" aria-hidden="true">·</span>
                  <MetaPill label="Section" value={citation.section} />
                </>
              )}
              {citation.pageOrLine !== undefined && (
                <>
                  <span className="text-slate-200" aria-hidden="true">·</span>
                  <MetaPill label="Page" value={String(citation.pageOrLine)} />
                </>
              )}
            </div>
          </div>

          {/* Verbatim excerpt */}
          <blockquote className="border-l-2 border-brand-200 pl-3">
            <p className="italic leading-relaxed text-slate-500">
              &ldquo;{citation.excerpt}&rdquo;
            </p>
          </blockquote>

          {/* Dev-only cosine score */}
          {isDev && (
            <p className="text-[9px] text-slate-300">
              chunk id: {citation.id} · cosine: {citation.score.toFixed(4)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
