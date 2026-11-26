"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// One search box for every list page: results update as you type (after a short pause), no
// Enter or "Apply" needed. It writes the `q` search param and keeps every other filter in the
// address, so the server page does the searching and the URL stays shareable.
export function LiveSearch({
  placeholder,
  label,
  param = "q",
  className = "",
}: {
  placeholder: string;
  label: string;
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back / forward or a "Clear" link changed the address: follow it.
  const [seen, setSeen] = useState(current);
  if (current !== seen) {
    setSeen(current);
    setValue(current);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set(param, next.trim());
    else params.delete(param);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 350);
  }

  return (
    <div className={`relative min-w-[16rem] flex-1 ${className}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            push(value);
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
