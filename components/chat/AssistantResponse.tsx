/**
 * AssistantResponse — structured renderer for assistant messages.
 *
 * Sections (each hidden when absent):
 *   1. Answer         — always present; full markdown rendering after stream
 *   2. Explanation    — optional elaboration with section label
 *   3. Sources        — collapsible citation chips
 *   4. Recommendations — amber banners for complex policies
 *   5. Related Policies — navigational pills
 *
 * Streaming behaviour:
 *   - While content is arriving: simple paragraph renderer + blinking cursor
 *   - Before first token: shimmer skeleton (looks like content loading in)
 *   - After stream: full markdown + copy button fade in
 */

"use client";

import { useState, useCallback } from "react";
import type {
  Citation,
  Recommendation,
  RelatedPolicy,
  StructuredResponse,
} from "@/types";

import CitationCard from "./CitationCard";
import RecommendationBanner from "./RecommendationBanner";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AssistantResponseProps {
  content: string;
  isStreaming: boolean;
  citations?: Citation[];
  recommendations?: Recommendation[];
  structuredResponse?: StructuredResponse;
}

// ── Markdown block types ──────────────────────────────────────────────────────

type MdBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; lines: string[] };

// ── Markdown block parser ─────────────────────────────────────────────────────

/**
 * Splits raw text into typed blocks (headings, lists, paragraphs).
 * Handles the typical output patterns of gpt-4o-mini for HR policy answers:
 *   ## Section headings, - bullet lists, 1. numbered lists, prose paragraphs.
 */
function parseBlocks(raw: string): MdBlock[] {
  const blocks: MdBlock[] = [];

  // Split on blank lines to get top-level chunks
  for (const chunk of raw.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const first = lines[0];

    // H2 heading
    if (first.startsWith("## ")) {
      blocks.push({ type: "h2", text: first.slice(3) });
      if (lines.length > 1) blocks.push({ type: "p", lines: lines.slice(1) });
      continue;
    }

    // H3 heading
    if (first.startsWith("### ")) {
      blocks.push({ type: "h3", text: first.slice(4) });
      if (lines.length > 1) blocks.push({ type: "p", lines: lines.slice(1) });
      continue;
    }

    // Unordered list — every line starts with - or *
    if (lines.every((l) => /^[-*•]\s+/.test(l))) {
      blocks.push({ type: "ul", items: lines.map((l) => l.replace(/^[-*•]\s+/, "")) });
      continue;
    }

    // Ordered list — every line starts with a digit and dot
    if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      blocks.push({ type: "ol", items: lines.map((l) => l.replace(/^\d+\.\s+/, "")) });
      continue;
    }

    // Default: paragraph (preserve single line-breaks as <br>)
    blocks.push({ type: "p", lines });
  }

  return blocks;
}

// ── Inline markdown renderer ──────────────────────────────────────────────────

/** Renders **bold**, *italic*, and `code` spans within a line of text. */
function renderInline(text: string): React.ReactNode {
  // Split preserving the matched tokens
  const parts = text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

// ── MarkdownContent — full renderer for completed responses ───────────────────

function MarkdownContent({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className="prose-chat">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2 key={i} className="mb-1.5 mt-3 text-sm font-semibold text-slate-900 first:mt-0">
                {renderInline(block.text)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={i} className="mb-1 mt-2.5 text-sm font-medium text-slate-900 first:mt-0">
                {renderInline(block.text)}
              </h3>
            );
          case "ul":
            return (
              <ul key={i} className="mb-2 space-y-1 last:mb-0">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span
                      className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                      aria-hidden="true"
                    />
                    <span className="flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mb-2 ml-5 list-decimal space-y-1 last:mb-0">
                {block.items.map((item, j) => (
                  <li key={j} className="pl-0.5">{renderInline(item)}</li>
                ))}
              </ol>
            );
          case "p":
            return (
              <p key={i}>
                {block.lines.map((line, j) => (
                  <span key={j}>
                    {renderInline(line)}
                    {j < block.lines.length - 1 && <br />}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

// ── StreamContent — simple renderer used while tokens are arriving ────────────

/** Avoids running the markdown parser on every token during streaming. */
function StreamContent({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  return (
    <div className="prose-chat">
      {paragraphs.map((para, pi) => (
        <p key={pi}>
          {para.split("\n").map((line, li, arr) => (
            <span key={li}>
              {line}
              {li < arr.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

// ── ResponseSkeleton — shimmer placeholder before first token ─────────────────

function ResponseSkeleton() {
  return (
    <div className="space-y-2.5" role="status" aria-label="Generating response">
      <div className="shimmer h-3 w-3/4 rounded-full" />
      <div className="shimmer h-3 w-full rounded-full" />
      <div className="shimmer h-3 w-5/6 rounded-full" />
      <div className="shimmer h-3 w-2/3 rounded-full" />
    </div>
  );
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={state === "copied" ? "Copied to clipboard" : "Copy response"}
      title={state === "copied" ? "Copied!" : "Copy response"}
      className={[
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
        state === "copied"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : state === "error"
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700",
      ].join(" ")}
    >
      {state === "copied" ? (
        <>
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="4" y="1.5" width="6.5" height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M1.5 4H3v6a1 1 0 001 1h4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-slate-400" aria-hidden="true">{icon}</span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        {children}
      </span>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-slate-100" />;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconLightbulb = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M7 1.5A4 4 0 014.5 8.5h5A4 4 0 017 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M5 10.5h4M5.5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const IconDocument = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="2.5" y="1.5" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 5h4M5 7.5h4M5 10h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const IconArrowRight = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7h9M8 4l3.5 3L8 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Related policy pill ───────────────────────────────────────────────────────

function RelatedPolicyPill({ policy }: { policy: RelatedPolicy }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm">
      <svg className="h-3 w-3 shrink-0 text-brand-400" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-medium">{policy.title}</span>
      {policy.category && <span className="text-slate-400">· {policy.category}</span>}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AssistantResponse({
  content,
  isStreaming,
  citations,
  recommendations,
  structuredResponse,
}: AssistantResponseProps) {
  const hasCitations      = citations && citations.length > 0;
  const hasRecommendations = recommendations && recommendations.length > 0;
  const hasRelated        = structuredResponse?.relatedPolicies && structuredResponse.relatedPolicies.length > 0;
  const hasExplanation    = Boolean(structuredResponse?.explanation);

  // ── Streaming / plain-text fallback view ───────────────────────────────────

  if (isStreaming || !structuredResponse) {
    return (
      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        {content ? (
          <>
            <StreamContent text={content} />
            {isStreaming && (
              // Blinking cursor — indicates tokens are still arriving
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-3.5 w-0.5 animate-blink rounded-sm bg-brand-400 align-middle"
              />
            )}
          </>
        ) : (
          // No content yet — shimmer skeleton hints at the card shape
          <ResponseSkeleton />
        )}
      </div>
    );
  }

  // ── Structured response view ────────────────────────────────────────────────

  const answerText = structuredResponse.answer || content;

  return (
    <div className="animate-fade-in space-y-2">

      {/* ── Main answer card ── */}
      <div className="overflow-hidden rounded-2xl rounded-tl-sm border border-slate-200 bg-white shadow-sm">

        {/* Section 1: Answer */}
        <div className="px-4 pt-3.5 pb-3">
          <MarkdownContent text={answerText} />

          {/* Copy + action row — always visible, low visual weight */}
          <div className="mt-3 flex items-center justify-end border-t border-slate-50 pt-2.5">
            <CopyButton text={answerText} />
          </div>
        </div>

        {/* Section 2: Explanation */}
        {hasExplanation && (
          <>
            <Divider />
            <div className="animate-fade-in px-4 py-3">
              <SectionLabel icon={<IconLightbulb />}>Explanation</SectionLabel>
              <div className="mt-2.5">
                <MarkdownContent text={structuredResponse.explanation!} />
              </div>
            </div>
          </>
        )}

        {/* Section 3: Sources */}
        {hasCitations && (
          <>
            <Divider />
            <div className="animate-fade-in bg-slate-50/60 px-4 py-3">
              <SectionLabel icon={<IconDocument />}>Sources</SectionLabel>
              <div className="mt-2.5 space-y-1.5">
                {citations!.map((c, i) => (
                  <CitationCard key={c.id} citation={c} index={i + 1} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Section 5: Related Policies */}
        {hasRelated && (
          <>
            <Divider />
            <div className="animate-fade-in bg-slate-50/60 px-4 py-3">
              <SectionLabel icon={<IconArrowRight />}>Related Policies</SectionLabel>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {structuredResponse.relatedPolicies!.map((p) => (
                  <RelatedPolicyPill key={p.title} policy={p} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 4: Recommendations — outside card for visual contrast */}
      {hasRecommendations && (
        <div className="animate-fade-in space-y-1.5">
          {recommendations!.map((rec) => (
            <RecommendationBanner key={rec.type} recommendation={rec} />
          ))}
        </div>
      )}
    </div>
  );
}
