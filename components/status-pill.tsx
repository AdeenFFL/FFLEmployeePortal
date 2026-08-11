const TONE_STYLES = {
  positive: "bg-emerald-100 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  warning: "bg-amber-100 text-amber-700",
  negative: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
} as const;

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof TONE_STYLES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${TONE_STYLES[tone]}`}
    >
      {label}
    </span>
  );
}
