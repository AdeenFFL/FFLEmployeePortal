"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// "Add X" forms (request type, category, site staff) — a real server mutation (not optimistic,
// there's no "new row" to show until the DB assigns it an id), but still no full-page reload:
// on success it resets the form and does a soft client refresh (router.refresh()) instead of the
// old redirect-with-?notice= round trip.
export function AddRowForm({
  action,
  children,
  className,
  submitLabel,
  submitClassName,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  submitLabel: string;
  submitClassName?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
        form.reset();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      {children}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? "Saving…" : submitLabel}
      </button>
      {error && <p className="text-sm text-red-600 md:col-span-4">{error}</p>}
    </form>
  );
}
