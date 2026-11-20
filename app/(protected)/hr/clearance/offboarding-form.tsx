"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitOwnClearance } from "./actions";

export function OffboardingForm({ minDate, maxDate }: { minDate: string; maxDate: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Submitted through a transition (not <form action>) so the function's message is shown
  // inline here, never through the URL.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const value = String(new FormData(e.currentTarget).get("last_working_date") ?? "");
    startTransition(async () => {
      try {
        const result = await submitOwnClearance(value);
        if (result.error) setError(result.error);
        // Re-read the page so the card (also inside the Home popup) shows the new request.
        else router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-slate-600">
        Leaving the company? Submit your clearance request here. HR will review it and start
        your clearance.
      </p>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Last working date</span>
        <input
          name="last_working_date"
          type="date"
          required
          min={minDate}
          max={maxDate}
          className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </label>

      <p className="text-xs text-slate-500">
        Please also hand your signed resignation letter to HR. It is not uploaded here.
      </p>

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
