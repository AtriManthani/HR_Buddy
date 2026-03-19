/**
 * Header — top navigation bar.
 *
 * Contains: logo mark, app title, subtitle, mobile menu toggle, and New Chat.
 * The mobile menu button only appears on small screens (hidden on md+).
 */

interface HeaderProps {
  onNewChat: () => void;
  onMenuToggle?: () => void;
  sidebarOpen?: boolean;
}

export default function Header({ onNewChat, onMenuToggle, sidebarOpen }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 shadow-sm">

      {/* Left: mobile menu button + brand */}
      <div className="flex items-center gap-3">

        {/* Hamburger — mobile only */}
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={sidebarOpen}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden"
          >
            {sidebarOpen ? (
              /* X icon */
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            ) : (
              /* Hamburger icon */
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            )}
          </button>
        )}

        {/* Logo mark */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 shadow-sm">
          <svg
            className="h-4 w-4 text-white"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 4h8v1.5H2V4zm0 3h10v1.5H2V7zm0 3h6v1.5H2V10z"
              fill="currentColor"
            />
            <circle cx="13" cy="12" r="2.5" fill="currentColor" opacity=".9" />
          </svg>
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-none text-slate-900">
            HR Policy Assistant
          </p>
          <p className="mt-0.5 hidden truncate text-xs leading-none text-slate-400 sm:block">
            Informational only · Powered by official documents
          </p>
        </div>
      </div>

      {/* Right: new chat */}
      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label="Start a new chat session"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">New Chat</span>
        <span className="sm:hidden" aria-hidden="true">New</span>
      </button>
    </header>
  );
}
