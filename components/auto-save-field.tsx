"use client";

import { useEffect, useRef, useState, useTransition } from "react";

// A plain input that saves itself — on blur, and after a short idle pause while typing — instead
// of needing a separate "Save" button/link. The bound action must throw on failure (same
// contract as OptimisticToggle); this shows "Saving…"/"Saved"/the error inline next to the field
// instead of a page-wide notice banner.
export function AutoSaveField({
  defaultValue,
  action,
  type = "text",
  label,
  placeholder,
  required,
  className,
  debounceMs = 600,
}: {
  defaultValue: string;
  action: (value: string) => Promise<void>;
  type?: "text" | "number";
  label: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
  debounceMs?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const savedValueRef = useRef(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function save(next: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (next === savedValueRef.current) return;
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      try {
        await action(next);
        savedValueRef.current = next;
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  function handleChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(next), debounceMs);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <input
        type={type}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        className={className}
      />
      {status === "saving" && <span className="shrink-0 text-xs text-slate-400">Saving…</span>}
      {status === "saved" && <span className="shrink-0 text-xs text-emerald-600">Saved</span>}
      {status === "error" && <span className="shrink-0 text-xs text-red-600">{error}</span>}
    </span>
  );
}
