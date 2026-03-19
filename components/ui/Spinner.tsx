/**
 * Spinner — accessible loading indicator.
 *
 * Used while:
 * - The chat API response is being fetched
 * - The vector store is initializing (cold start)
 *
 * Props:
 *   size  — "sm" | "md" | "lg"
 *   label — screen-reader text (defaults to "Loading…")
 */

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

const sizeClasses = {
  sm: "h-3 w-3 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-7 w-7 border-[3px]",
};

export default function Spinner({
  size = "md",
  label = "Loading…",
}: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <span
        className={`animate-spin rounded-full border-slate-300 border-t-brand-500 ${sizeClasses[size]}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
