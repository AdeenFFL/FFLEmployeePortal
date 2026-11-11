"use client"; // Error boundaries must be Client Components

import { ErrorCampfire } from "@/components/error-campfire";

// Covers every page under (protected) by default. A route with a known, specific failure mode
// (see app/(protected)/it/error.tsx's "schema not exposed" case) gets its own error.tsx passing
// a tailored title/description into the same <ErrorCampfire />, rather than writing a new error
// UI from scratch.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorCampfire error={error} retry={reset} />;
}
