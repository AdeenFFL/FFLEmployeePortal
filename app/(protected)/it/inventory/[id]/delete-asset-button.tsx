"use client";

import { useFormStatus } from "react-dom";

// Submit button for the soft-delete form on the asset detail page. Confirms first, because a
// deleted asset disappears from the register (the row is kept, but there is no undelete screen).
export function DeleteAssetButton({ assetTag }: { assetTag: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (
          !window.confirm(
            `Delete ${assetTag}? It will be removed from the register. Use Retired or Disposed instead if the asset really existed.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
