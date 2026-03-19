/**
 * ErrorBanner — inline error notification with optional retry action.
 *
 * Shown when the chat API request fails or the vector store is unavailable.
 * The retry button re-submits the last user message.
 */

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

export default function ErrorBanner({
  message,
  onDismiss,
  onRetry,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs shadow-sm"
    >
      {/* Icon */}
      <div className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 ring-1 ring-red-200">
        <svg
          className="h-3 w-3 text-red-600"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M6 3.5v3M6 8v.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Message + hint */}
      <div className="flex-1 min-w-0">
        <p className="leading-relaxed text-red-800">{message}</p>
        {onRetry && (
          <p className="mt-0.5 text-[10px] text-red-500">
            Your message was not lost — retry to resend it.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="rounded-lg p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
