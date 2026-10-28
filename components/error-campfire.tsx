"use client";

import { useEffect } from "react";
import { BurntCampfireIcon } from "@/components/icons";

// The standard error.tsx body. Practice: every new page/route segment gets an error.tsx — copy
// app/(protected)/it/error.tsx (or the root one) rather than writing a new error UI from
// scratch. `error`/`retry` are exactly what Next.js's error.tsx convention passes a Client
// Component error boundary; this component just renders them consistently. A route can pass its
// own `title`/`description` for a known failure mode (see it/error.tsx's "schema not exposed"
// case) — unset falls back to a generic message.
export function ErrorCampfire({
  error,
  retry,
  title = "Something went wrong",
  description = "This page couldn't load. Try again; if it keeps happening, contact support.",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: React.ReactNode;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <BurntCampfireIcon className="mx-auto h-10 w-10" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
        {error.digest && <p className="mt-3 text-xs text-slate-400">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
