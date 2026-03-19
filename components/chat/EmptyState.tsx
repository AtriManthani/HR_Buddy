/**
 * EmptyState — onboarding landing screen shown before the first message.
 *
 * First-time view (hasSession = false):
 *   Full onboarding: hero, scope card, category grid, suggested questions.
 *
 * Returning view (hasSession = true):
 *   Compact: hero + suggested questions only. The user already knows the scope.
 *
 * Category and question chips call onSelectQuestion which ChatWindow submits
 * directly — no intermediate state, no forms.
 */

// ── Static data ───────────────────────────────────────────────────────────────

/** Policy categories — each maps to a representative starter question. */
const CATEGORIES = [
  {
    label:    "Leave & Time Off",
    icon:     "🏖",
    question: "How many days of annual leave am I entitled to?",
  },
  {
    label:    "Health & Benefits",
    icon:     "🏥",
    question: "What health and wellness benefits am I eligible for?",
  },
  {
    label:    "Code of Conduct",
    icon:     "📋",
    question: "What does the code of conduct cover?",
  },
  {
    label:    "Compensation & Pay",
    icon:     "💰",
    question: "How is my compensation and pay structured?",
  },
  {
    label:    "Performance",
    icon:     "📈",
    question: "How does the performance review process work?",
  },
  {
    label:    "Remote Work",
    icon:     "🏠",
    question: "What are the remote and hybrid working guidelines?",
  },
  {
    label:    "Workplace Safety",
    icon:     "🛡",
    question: "What are the workplace health and safety requirements?",
  },
  {
    label:    "Learning & Dev",
    icon:     "🎓",
    question: "What learning and development support is available to me?",
  },
];

/** Curated questions shown as one-click starters. */
const SUGGESTED_QUESTIONS = [
  "How many days of annual leave am I entitled to?",
  "What is the sick leave policy?",
  "How does the performance review process work?",
  "What are the remote working guidelines?",
];

/** What the assistant is designed to do. */
const CAN_DO = [
  "Answer questions using official policy documents",
  "Show the exact source for every answer",
  "Explain leave entitlements, benefits, and procedures",
  "Clarify policy terms in plain language",
];

/** What the assistant explicitly cannot do — the non-agentic guarantee. */
const CANNOT_DO = [
  "Submit forms or requests on your behalf",
  "Book leave or update attendance records",
  "Send emails or contact HR directly",
  "Grant exceptions or approve anything",
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onSelectQuestion: (q: string) => void;
  hasSession?: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Animated section wrapper — slides up from a slight offset. */
function Section({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-slide-up ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Section heading in the same style used throughout the app. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </p>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Scope card — two-column overview of what the assistant can and cannot do.
 * This is the most important onboarding signal: sets correct expectations
 * and makes the non-agentic guarantee explicit before the first message.
 */
function ScopeCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      {/* Card header */}
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-100">
          <svg
            className="h-3.5 w-3.5 text-brand-600"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M7 5v2.5L8.5 9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="text-xs font-semibold text-slate-700">About this assistant</p>
      </div>

      {/* Two-column scope grid */}
      <div className="grid grid-cols-2 divide-x divide-slate-100">

        {/* Can do */}
        <div className="p-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-2.5 w-2.5 text-emerald-600" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="text-[11px] font-semibold text-emerald-700">Can help with</span>
          </div>
          <ul className="space-y-2" role="list">
            {CAN_DO.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Cannot do */}
        <div className="p-4">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100">
              <svg className="h-2.5 w-2.5 text-red-500" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-[11px] font-semibold text-red-600">Cannot do</span>
          </div>
          <ul className="space-y-2" role="list">
            {CANNOT_DO.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-200" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer note */}
      <div className="border-t border-slate-100 bg-amber-50/60 px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-amber-700">
          <span className="font-semibold">Policy guidance only.</span>{" "}
          For HR actions — submitting requests, approving leave, or updating records — please
          contact your HR team directly or use the HR portal.
        </p>
      </div>
    </div>
  );
}

/** Clickable grid of policy categories. */
function CategoryGrid({
  onSelectQuestion,
}: {
  onSelectQuestion: (q: string) => void;
}) {
  return (
    <div>
      <SectionHeading>Browse by category</SectionHeading>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.label}
            type="button"
            onClick={() => onSelectQuestion(cat.question)}
            className="group flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-3.5 text-center shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="text-xl leading-none" aria-hidden="true">{cat.icon}</span>
            <span className="text-[11px] font-medium leading-tight text-slate-600 group-hover:text-brand-700">
              {cat.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Clickable list of curated starter questions. */
function SuggestedQuestions({
  onSelectQuestion,
}: {
  onSelectQuestion: (q: string) => void;
}) {
  return (
    <div>
      <SectionHeading>Or try asking</SectionHeading>
      <div className="flex flex-col gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSelectQuestion(q)}
            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-brand-300 hover:bg-brand-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-400"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 7h9M8 4l3.5 3L8 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-sm text-slate-600 group-hover:text-brand-700">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EmptyState({
  onSelectQuestion,
  hasSession = false,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto scrollbar-thin px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl space-y-6">

        {/* ── Hero ── */}
        <Section delay={0} className="text-center">
          {/* Icon badge */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-brand-50 to-brand-100 ring-1 ring-brand-200 shadow-sm">
            <svg
              className="h-7 w-7 text-brand-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 6h8M8 10h5M4 4h16a1 1 0 011 1v10a1 1 0 01-1 1H7l-4 4V5a1 1 0 011-1z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {hasSession ? (
            <>
              <h1 className="text-base font-semibold text-slate-800">
                Ready for your next question
              </h1>
              <p className="mt-1.5 text-sm text-slate-500">
                Ask anything about company policies and I&apos;ll find the answer in the official documents.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-slate-800">
                HR Policy Assistant
              </h1>
              <p className="mt-1.5 text-sm text-slate-500">
                Get instant, cited answers from official company policy documents.
                Every response links back to the exact source.
              </p>
            </>
          )}
        </Section>

        {/* ── Scope card — first-time users only ── */}
        {!hasSession && (
          <Section delay={80}>
            <ScopeCard />
          </Section>
        )}

        {/* ── Policy categories ── */}
        <Section delay={hasSession ? 60 : 160}>
          <CategoryGrid onSelectQuestion={onSelectQuestion} />
        </Section>

        {/* ── Suggested questions ── */}
        <Section delay={hasSession ? 100 : 220}>
          <SuggestedQuestions onSelectQuestion={onSelectQuestion} />
        </Section>

        {/* ── Trust footer ── */}
        <Section delay={hasSession ? 140 : 280}>
          <div className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <svg
              className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 1.5L2 4v3.5c0 2.8 2 5.2 5 5.5 3-0.3 5-2.7 5-5.5V4L7 1.5z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-[10px] leading-relaxed text-slate-500">
              Answers are sourced exclusively from official HR policy documents and include
              citations for verification. This assistant provides{" "}
              <span className="font-medium text-slate-600">guidance only</span> — it does not
              take actions, submit requests, or access any HR systems.
            </p>
          </div>
        </Section>

      </div>
    </div>
  );
}
