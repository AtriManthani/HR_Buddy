/**
 * RecommendationBanner — informational callout for contextual policy guidance.
 *
 * Rendered below the main answer card (never inside it) so the amber colour
 * stands out as a distinct visual layer.  The parent maps over the
 * recommendations array and renders one banner per item.
 *
 * Icon selection is driven by the recommendation type:
 *   eligibility   — checklist tick
 *   documentation — document/form
 *   cross-policy  — link / network
 *   complexity    — stacked layers
 *   low-confidence— info circle (default)
 *
 * Purely informational — no buttons, no links, no action triggers.
 */

import type { Recommendation, RecommendationType } from "@/types";

// ── Type-specific icons ────────────────────────────────────────────────────────

function IconEligibility() {
  return (
    <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 6l1.8 1.8L8.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDocumentation() {
  return (
    <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2" y="1" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 4.5h4M4 6.5h4M4 8.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconCrossPolicy() {
  return (
    <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="2.5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9.5" cy="2.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 6l4-3.5M4 6l4 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function IconComplexity() {
  return (
    <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 9h9M2.5 6.5h7M3.5 4h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg className="h-3 w-3 text-amber-600" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 5.5v3M6 3.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RecommendationIcon({ type }: { type: RecommendationType }) {
  switch (type) {
    case "eligibility":    return <IconEligibility />;
    case "documentation":  return <IconDocumentation />;
    case "cross-policy":   return <IconCrossPolicy />;
    case "complexity":     return <IconComplexity />;
    case "low-confidence": return <IconInfo />;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

interface RecommendationBannerProps {
  recommendation: Recommendation;
}

export default function RecommendationBanner({
  recommendation,
}: RecommendationBannerProps) {
  return (
    <div
      role="note"
      aria-label="Policy recommendation"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs shadow-sm"
    >
      {/* Icon column */}
      <div className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-200">
        <RecommendationIcon type={recommendation.type} />
      </div>

      {/* Text column */}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-900">{recommendation.headline}</p>
        <p className="mt-0.5 leading-relaxed text-amber-700">
          {recommendation.detail}
        </p>
      </div>
    </div>
  );
}
