// A friendly empty box for the clearance screens: a small icon and one line.
export function EmptyState({
  icon,
  text,
  className = "",
}: {
  icon: string;
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center shadow-sm ${className}`}
    >
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}
