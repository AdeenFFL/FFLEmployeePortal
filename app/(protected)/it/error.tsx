"use client"; // Error boundaries must be Client Components

import { ErrorCampfire } from "@/components/error-campfire";

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
  const schemaNotExposed = /invalid schema: it/i.test(error.message);

  return (
    <ErrorCampfire
      error={error}
      retry={retry}
      title={schemaNotExposed ? "IT data isn't reachable yet" : undefined}
      description={
        schemaNotExposed ? (
          <>
            Supabase isn&apos;t serving the <code className="rounded bg-slate-100 px-1">it</code>{" "}
            schema. An admin needs to add <strong>it</strong> under{" "}
            <em>Project Settings → Data API → Exposed schemas</em> and save.
          </>
        ) : (
          "This IT page couldn't load. Try again; if it keeps happening, contact IT support."
        )
      }
    />
  );
}
