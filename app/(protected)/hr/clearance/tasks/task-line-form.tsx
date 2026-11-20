"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClearanceAnswer } from "../[caseId]/[slotKey]/actions";

type Outcome = "Yes" | "No" | "N/A";
const OUTCOMES: Outcome[] = ["Yes", "No", "N/A"];

// One line the IT Team Lead handed to me: answer it (Yes / No / N/A + remarks) and save. The
// database lets me answer only my own lines. Errors stay inline.
export function TaskLineForm({
  caseId,
  lineId,
  description,
  outcome,
  remarks,
}: {
  caseId: string;
  lineId: string;
  description: string;
  outcome: Outcome | null;
  remarks: string | null;
}) {
  const router = useRouter();
  const [draftOutcome, setDraftOutcome] = useState<Outcome | null>(outcome);
  const [draftRemarks, setDraftRemarks] = useState(remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const changed = draftOutcome !== outcome || draftRemarks.trim() !== (remarks ?? "").trim();

  function handleSave() {
    setError(null);
    setJustSaved(false);
    if (!draftOutcome) {
      setError("Please choose an answer.");
      return;
    }
    if (draftOutcome === "No" && !draftRemarks.trim()) {
      setError("Please write a short remark for this answer.");
      return;
    }
    const answer = draftOutcome;
    startSaving(async () => {
      try {
        const result = await saveClearanceAnswer(caseId, lineId, answer, draftRemarks);
        if (result.error) {
          setError(result.error);
          return;
        }
        setJustSaved(true);
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 py-4">
      <p className="text-sm font-medium text-slate-900">{description}</p>
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={description}>
        {OUTCOMES.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name={`task-${caseId}-${lineId}`}
              checked={draftOutcome === o}
              onChange={() => {
                setDraftOutcome(o);
                setJustSaved(false);
              }}
              disabled={isSaving}
            />
            {o}
          </label>
        ))}
      </div>
      <input
        type="text"
        value={draftRemarks}
        onChange={(e) => {
          setDraftRemarks(e.target.value);
          setJustSaved(false);
        }}
        maxLength={500}
        placeholder={draftOutcome === "No" ? "Remarks (required)" : "Remarks (optional)"}
        aria-label={`Remarks: ${description}`}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        disabled={isSaving}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !changed}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        {justSaved && !changed && <span className="text-xs text-green-700">Saved</span>}
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </li>
  );
}
