"use client";

import { useOptimistic, useState, useTransition } from "react";
import { XIcon } from "@/components/icons";

export type SiteAssignment = { siteId: string; siteName: string; role: "manager" | "member" };
export type SiteCandidate = { siteId: string; siteName: string };

type Action =
  | { type: "add"; assignment: SiteAssignment }
  | { type: "remove"; siteId: string }
  | { type: "setRole"; siteId: string; role: "manager" | "member" };

function reduce(assignments: SiteAssignment[], action: Action): SiteAssignment[] {
  switch (action.type) {
    case "add":
      return [...assignments, action.assignment];
    case "remove":
      return assignments.filter((a) => a.siteId !== action.siteId);
    case "setRole":
      return assignments.map((a) => (a.siteId === action.siteId ? { ...a, role: action.role } : a));
  }
}

// Which sites one IT-department person covers, and whether they manage or just work each one —
// same useOptimistic + useTransition + throw-to-revert shape as components/owner-chips.tsx, but
// inverted (one row = a person, chips = their sites) and with a plain two-state role toggle per
// chip instead of a single "primary" exclusivity, since more than one manager per site is fine.
export function SiteAssignmentChips({
  assignments,
  available,
  canEdit,
  onAdd,
  onRemove,
  onSetRole,
}: {
  assignments: SiteAssignment[];
  available: SiteCandidate[];
  canEdit: boolean;
  onAdd: (siteId: string, role: "manager" | "member") => Promise<void>;
  onRemove: (siteId: string) => Promise<void>;
  onSetRole: (siteId: string, role: "manager" | "member") => Promise<void>;
}) {
  const [optimisticAssignments, dispatch] = useOptimistic(assignments, reduce);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remaining = available.filter((a) => !optimisticAssignments.some((x) => x.siteId === a.siteId));

  function handleRemove(siteId: string) {
    setError(null);
    startTransition(async () => {
      dispatch({ type: "remove", siteId });
      try {
        await onRemove(siteId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove site.");
      }
    });
  }

  function handleToggleRole(siteId: string, current: "manager" | "member") {
    const next = current === "manager" ? "member" : "manager";
    setError(null);
    startTransition(async () => {
      dispatch({ type: "setRole", siteId, role: next });
      try {
        await onSetRole(siteId, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to change role.");
      }
    });
  }

  function handleAdd(siteId: string) {
    const candidate = available.find((a) => a.siteId === siteId);
    if (!candidate) return;
    setError(null);
    startTransition(async () => {
      dispatch({ type: "add", assignment: { siteId, siteName: candidate.siteName, role: "member" } });
      try {
        await onAdd(siteId, "member");
      } catch (e) {
        dispatch({ type: "remove", siteId });
        setError(e instanceof Error ? e.message : "Failed to assign site.");
      }
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {optimisticAssignments.length === 0 && !canEdit && (
        <span className="text-xs text-slate-400">No sites assigned</span>
      )}
      {optimisticAssignments.map((a) => (
        <span
          key={a.siteId}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2 pr-1 text-xs text-slate-700"
        >
          {a.siteName}
          {canEdit ? (
            <button
              type="button"
              onClick={() => handleToggleRole(a.siteId, a.role)}
              title={a.role === "manager" ? "Manager — click to make member" : "Member — click to make manager"}
              className={a.role === "manager" ? "font-medium text-blue-700" : "text-slate-400 hover:text-blue-700"}
            >
              {a.role === "manager" ? "Manager" : "Member"}
            </button>
          ) : (
            <span className={a.role === "manager" ? "font-medium text-blue-700" : "text-slate-400"}>
              {a.role === "manager" ? "Manager" : "Member"}
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => handleRemove(a.siteId)}
              aria-label={`Remove ${a.siteName}`}
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
          aria-label="Assign a site"
          onChange={(e) => {
            if (e.target.value) handleAdd(e.target.value);
            e.target.value = "";
          }}
          className="rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="" disabled>
            Assign a site…
          </option>
          {remaining.map((a) => (
            <option key={a.siteId} value={a.siteId}>
              {a.siteName}
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
