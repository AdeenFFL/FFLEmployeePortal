"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ProcurementTab = { href: string; label: string; match?: string[] };

// Slim section bar for IT Procurement: tabs on the left, the one primary action on the right.
export function ProcurementNav({ tabs, canRaise }: { tabs: ProcurementTab[]; canRaise: boolean }) {
  const pathname = usePathname();
  const raising = pathname === "/it/procurement/demands/new";
  const isActive = (t: ProcurementTab) =>
    !raising && (t.match ?? [t.href]).some((m) => pathname === m || pathname.startsWith(`${m}/`));

  return (
    <div className="sticky top-0 z-10 -mx-8 mb-2 border-b border-slate-200 bg-slate-50/90 px-8 backdrop-blur">
      <div className="flex items-center gap-4">
        <p className="hidden shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400 md:block">
          Procurement
        </p>
        <nav aria-label="Procurement" className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active = isActive(t);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {canRaise && !raising && (
          <Link
            href="/it/procurement/demands/new"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            <span aria-hidden className="text-base leading-none">+</span>
            Raise demand
          </Link>
        )}
      </div>
    </div>
  );
}
