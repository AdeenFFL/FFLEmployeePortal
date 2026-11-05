"use client";

import { useOptimistic, useState, useTransition } from "react";
import { StarIcon, XIcon } from "@/components/icons";

export type OwnerChip = { personId: string; fullName: string; isPrimary: boolean };
export type OwnerCandidate = { personId: string; fullName: string };

type Action =
  | { type: "add"; owner: OwnerChip }
  | { type: "remove"; personId: string }
  | { type: "setPrimary"; personId: string };

function reduce(owners: OwnerChip[], action: Action): OwnerChip[] {
  switch (action.type) {
    case "add":
      return [...owners, action.owner];
    case "remove":
      return owners.filter((o) => o.personId !== action.personId);
    case "setPrimary":
      return owners.map((o) => ({ ...o, isPrimary: o.personId === action.personId }));
  }
}

// Who a category/task-type auto-assigns to — add/remove/★ primary, all optimistic. Same
// useOptimistic + useTransition + throw-to-revert contract as OptimisticToggle, generalized to a
// small list instead of one boolean. Used inline on category and onboarding-task rows (IT
// Settings redesign) instead of a separate "Owners" tab.
export function OwnerChips({
  owners,
  available,
  canEdit,
  onAdd,
  onRemove,
  onSetPrimary,
  addLabel = "Add owner…",
}: {
  owners: OwnerChip[];
  available: OwnerCandidate[];
  canEdit: boolean;
  onAdd: (personId: string, makePrimary: boolean) => Promise<void>;
  onRemove: (personId: string) => Promise<void>;
  onSetPrimary: (personId: string) => Promise<void>;
  addLabel?: string;
}) {
  const [optimisticOwners, dispatch] = useOptimistic(owners, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remaining = available.filter((a) => !optimisticOwners.some((o) => o.personId === a.personId));

  function handleRemove(personId: string) {
    setError(null);
    startTransition(async () => {
      dispatch({ type: "remove", personId });
      try {
        await onRemove(personId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove owner.");
      }
    });
  }

  function handleSetPrimary(personId: string) {
    setError(null);
    startTransition(async () => {
      dispatch({ type: "setPrimary", personId });
      try {
        await onSetPrimary(personId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to change primary owner.");
      }
    });
  }

  function handleAdd(personId: string) {
    const candidate = available.find((a) => a.personId === personId);
    if (!candidate) return;
    const makePrimary = optimisticOwners.length === 0;
    setError(null);
    startTransition(async () => {
      dispatch({ type: "add", owner: { personId, fullName: candidate.fullName, isPrimary: makePrimary } });
      try {
        await onAdd(personId, makePrimary);
      } catch (e) {
        dispatch({ type: "remove", personId });
        setError(e instanceof Error ? e.message : "Failed to add owner.");
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {optimisticOwners.length === 0 && !canEdit && (
        <span className="text-xs text-slate-400">No owner</span>
      )}
      {optimisticOwners.length === 0 && canEdit && remaining.length === 0 && (
        <span className="text-xs text-slate-400">
          No eligible staff for this site — add someone to Sites &amp; IT Staff first.
        </span>
      )}
      {optimisticOwners.map((o) => (
        <span
          key={o.personId}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-700"
        >
          {canEdit ? (
            <button
              type="button"
              onClick={() => handleSetPrimary(o.personId)}
              title={o.isPrimary ? "Primary owner" : "Make primary"}
              disabled={o.isPrimary}
              className={o.isPrimary ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}
            >
              <StarIcon filled={o.isPrimary} className="h-3.5 w-3.5" />
            </button>
          ) : (
            o.isPrimary && <StarIcon filled className="h-3.5 w-3.5 text-amber-500" />
          )}
          {o.fullName}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleRemove(o.personId)}
              aria-label={`Remove ${o.fullName}`}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-red-600"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit && remaining.length > 0 && (
        <select
          defaultValue=""
          aria-label={addLabel}
          onChange={(e) => {
            if (e.target.value) handleAdd(e.target.value);
            e.target.value = "";
          }}
          className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="" disabled>
            {addLabel}
          </option>
          {remaining.map((a) => (
            <option key={a.personId} value={a.personId}>
              {a.fullName}
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
