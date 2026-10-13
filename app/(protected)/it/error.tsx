"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

// Error boundary for every /it/* page. The most common failure while the module is being set
// up is the `it` schema missing from Supabase's Exposed Schemas list (PostgREST answers
// "Invalid schema: it"), so that case gets an explanation instead of a raw stack trace.
// Note: in production builds Next.js replaces server error messages with a generic one, so
// the specific hint only shows in development; the generic text still applies.
export default function ItError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const schemaNotExposed = /invalid schema: it/i.test(error.message);

  return (
    <div className="py-16">
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {schemaNotExposed ? "IT data isn't reachable yet" : "Something went wrong"}
        </h1>
        {schemaNotExposed ? (
          <p className="mt-2 text-sm text-slate-600">
            Supabase isn&apos;t serving the <code className="rounded bg-slate-100 px-1">it</code>{" "}
            schema. An admin needs to add <strong>it</strong> under{" "}
            <em>Project Settings → Data API → Exposed schemas</em> and save.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            This IT page couldn&apos;t load. Try again; if it keeps happening, contact IT support.
          </p>
        )}
        {error.digest && (
          <p className="mt-3 text-xs text-slate-400">Reference: {error.digest}</p>
        )}
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
