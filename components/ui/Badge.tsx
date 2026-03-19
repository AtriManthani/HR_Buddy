/**
 * Badge — small label chip for tagging content.
 *
 * Used for:
 * - Policy category tags on citation cards
 * - Relevance score indicators (dev mode)
 * - Status labels
 *
 * Variants: default | info | warning | success
 */

type BadgeVariant = "default" | "info" | "warning" | "success";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-600",
  info: "bg-blue-50 text-blue-700",
  warning: "bg-amber-50 text-amber-700",
  success: "bg-green-50 text-green-700",
};

export default function Badge({ label, variant = "default" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}
