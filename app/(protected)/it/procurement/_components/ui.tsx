import Link from "next/link";

// Small shared pieces so every procurement page looks the same.

// Segmented sub-navigation inside one tab (e.g. Settings: Rules | Department approvers).
export function SubTabs({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            i.key === active ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

// Count tile. With href it becomes a shortcut to the matching filter.
export function StatTile({
  label,
  value,
  tone = "slate",
  href,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "blue" | "amber" | "emerald" | "red";
  href?: string;
  hint?: string;
}) {
  const accent = {
    slate: "bg-slate-400",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
    red: "bg-red-500",
  }[tone];
  const body = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${accent}`} aria-hidden />
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </>
  );
  const cls = "relative block overflow-hidden rounded-xl border border-slate-200 bg-white py-4 pl-5 pr-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-slate-300 hover:shadow`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Friendly empty state with an optional call to action.
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{text}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

// Quiet "back" link for detail pages (the tab bar already shows where you are).
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-slate-500 hover:text-slate-800">
      ← {label}
    </Link>
  );
}

// One section of a master-data form: title + hint on the left, fields on the right.
export function FormGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 px-6 py-5 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

// Segmented filter links (e.g. Active | Inactive | All) for list pages.
export function FilterChips({ label, items }: { label: string; items: { label: string; href: string; active: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          aria-current={i.active ? "true" : undefined}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            i.active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

// Two-letter avatar text for a name.
export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

export const SETTINGS_TABS = [
  { key: "rules", href: "/it/procurement/settings", label: "Rules" },
  { key: "approvers", href: "/it/procurement/settings/approvers", label: "Department approvers" },
];
