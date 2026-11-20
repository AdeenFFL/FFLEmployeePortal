"use client";

import { useState, useTransition } from "react";
import { TrashIcon } from "@/components/icons";
import { hardDeleteUser } from "./actions";

// The trash icon of a user row: a native confirm() first (the delete is irreversible), then the
// action. If the database refuses (e.g. the person has IT asset history), the reason shows inline
// under the icon, never in the URL.
export function DeleteUserButton({
  personId,
  confirmMessage,
}: {
  personId: string;
  confirmMessage: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await hardDeleteUser(personId);
        if (result.error) setError(result.error);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        title="Permanently delete user"
        aria-label="Permanently delete user"
        disabled={isPending}
        onClick={handleClick}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:opacity-60"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
      {error && (
        <p className="max-w-xs rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
