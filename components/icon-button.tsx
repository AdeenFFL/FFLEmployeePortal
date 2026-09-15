import Link from "next/link";
import type { ReactNode } from "react";

// Shared visual language for row-level actions across every admin table (Edit/Rename/Duplicate/
// Delete/Revoke) — icon-only, tooltipped via `label`, tone-coded so destructive actions read as
// destructive at a glance instead of every action looking like plain underlined text.
type Tone = "neutral" | "primary" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
  primary: "text-blue-600 hover:bg-blue-50 hover:text-blue-700",
  danger: "text-red-500 hover:bg-red-50 hover:text-red-600",
};

const BASE_CLASSES =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1";

// For use inside a <form action={...}> (Server Actions) — most row actions (Delete/Revoke/
// Duplicate) are mutations, not navigation.
export function IconButton({
  icon,
  label,
  tone = "neutral",
  type = "submit",
}: {
  icon: ReactNode;
  label: string;
  tone?: Tone;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      className={`${BASE_CLASSES} ${TONE_CLASSES[tone]}`}
    >
      {icon}
    </button>
  );
}

// For plain navigation (Edit, which just sets a ?edit= query param).
export function IconLink({
  href,
  icon,
  label,
  tone = "neutral",
}: {
  href: string;
  icon: ReactNode;
  label: string;
  tone?: Tone;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={`${BASE_CLASSES} ${TONE_CLASSES[tone]}`}
    >
      {icon}
    </Link>
  );
}
