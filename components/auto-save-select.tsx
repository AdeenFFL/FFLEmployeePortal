"use client";

import { useState, useTransition } from "react";

// Same auto-save contract as AutoSaveField, for a <select> that should save the instant the
// viewer picks something instead of needing a separate "Save" button.
export function AutoSaveSelect({
  defaultValue,
  action,
  label,
  children,
  className,
}: {
  defaultValue: string;
  action: (value: string) => Promise<void>;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleChange(next: string) {
    setValue(next);
    setError(null);
    setStatus("saving");
    startTransition(async () => {
      try {
        await action(next);
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select value={value} onChange={(e) => handleChange(e.target.value)} aria-label={label} className={className}>
        {children}
      </select>
      {status === "saving" && <span className="text-xs text-slate-400">Saving…</span>}
      {status === "saved" && <span className="text-xs text-emerald-600">Saved</span>}
      {status === "error" && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
