"use client";

import { useState, useTransition } from "react";
import { saveClearanceAnswer, signClearancePart } from "./actions";

type Outcome = "Yes" | "No" | "N/A";
type Answer = { outcome: Outcome | null; remarks: string };

export type FormLine = {
  id: string;
  description: string;
  // Page-one lines that fill themselves when that form is signed: shown, never answered here.
  auto: boolean;
  autoFormTitle: string | null;
  outcome: Outcome | null;
  remarks: string | null;
  // Set when someone else answers this line (the line manager's "data received"): shown only.
  lockedNote?: string | null;
};

const OUTCOMES: Outcome[] = ["Yes", "No", "N/A"];
const NEGATIVE_NEEDS_REMARK = "Please write a short remark for this answer.";
const CONFIRM_TEXT =
  "I confirm this part is complete. Your name and the time are recorded as your electronic signature.";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

function sameAnswer(a: Answer, b: Answer) {
  return a.outcome === b.outcome && a.remarks.trim() === b.remarks.trim();
}

// The signer's part of the form: one radio group + remarks per line, ONE "Save answers" button
// that saves only the changed lines one by one (stopping at the first error, shown under that
// line), and the Sign box. All messages stay inline, never in the URL.
export function SlotForm({
  caseId,
  slotKey,
  lines,
  labels,
  waitingFor,
  signHint = null,
  signBlocker = null,
}: {
  caseId: string;
  slotKey: string;
  lines: FormLine[];
  labels: Record<Outcome, string>;
  // HR signs last: the labels of the other parts that have not signed yet.
  waitingFor: string[];
  // A soft warning in the Sign box; unlike the blockers it does not disable Sign.
  signHint?: string | null;
  // Something outside this form that must be done first (e.g. assets still assigned): disables Sign.
  signBlocker?: string | null;
}) {
  const editable = lines.filter((l) => !l.auto && !l.lockedNote);
  const initial = () =>
    new Map<string, Answer>(
      editable.map((l) => [l.id, { outcome: l.outcome, remarks: l.remarks ?? "" }]),
    );

  // `saved` is what the database holds; `draft` is what is on screen.
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map());
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const [confirmed, setConfirmed] = useState(false);
  const [signRemarks, setSignRemarks] = useState("");
  const [signError, setSignError] = useState<string | null>(null);
  const [isSigning, startSigning] = useTransition();

  const changedIds = editable
    .filter((l) => !sameAnswer(draft.get(l.id)!, saved.get(l.id)!))
    .map((l) => l.id);
  const unansweredCount = editable.filter((l) => !saved.get(l.id)!.outcome).length;

  function update(lineId: string, patch: Partial<Answer>) {
    setDraft((prev) => new Map(prev).set(lineId, { ...prev.get(lineId)!, ...patch }));
    setJustSaved((prev) => {
      const next = new Set(prev);
      next.delete(lineId);
      return next;
    });
  }

  function handleSave() {
    setSaveError(null);
    setLineErrors(new Map());
    startSaving(async () => {
      try {
        for (const lineId of changedIds) {
          const answer = draft.get(lineId)!;
          let error: string | null = null;
          if (!answer.outcome) error = "Please choose an answer.";
          else if (answer.outcome === "No" && !answer.remarks.trim()) error = NEGATIVE_NEEDS_REMARK;
          else {
            const result = await saveClearanceAnswer(caseId, lineId, answer.outcome, answer.remarks);
            error = result.error;
          }
          if (error) {
            setLineErrors(new Map([[lineId, error]]));
            return;
          }
          setSaved((prev) => new Map(prev).set(lineId, answer));
          setJustSaved((prev) => new Set(prev).add(lineId));
        }
      } catch {
        setSaveError("Something went wrong. Please try again.");
      }
    });
  }

  function handleSign() {
    setSignError(null);
    startSigning(async () => {
      try {
        const result = await signClearancePart(caseId, slotKey, signRemarks);
        if (result.error) setSignError(result.error);
        // On success the action revalidates this page, which then shows the locked view.
      } catch {
        setSignError("Something went wrong. Please try again.");
      }
    });
  }

  const signBlockers: string[] = [];
  if (waitingFor.length > 0) {
    signBlockers.push(`HR signs last: waiting for ${waitingFor.join(", ")}.`);
  }
  if (unansweredCount > 0) {
    signBlockers.push(
      `${unansweredCount} line${unansweredCount === 1 ? " still needs" : "s still need"} an answer.`,
    );
  }
  if (lines.some((l) => l.lockedNote && !l.outcome)) {
    signBlockers.push("Waiting for the line manager to confirm “Complete data received”.");
  }
  if (signBlocker) signBlockers.push(signBlocker);
  if (changedIds.length > 0) signBlockers.push("Save your answers first.");
  const busy = isSaving || isSigning;

  return (
    <div className="flex flex-col gap-6">
      {lines.length === 0 ? (
        <p className="text-sm text-slate-600">
          This part has no checklist. Sign to confirm the employee&apos;s department clearance.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-100">
          {lines.map((line) => {
            if (line.auto) {
              return (
                <li key={line.id} className="py-4">
                  <p className="text-sm font-medium text-slate-900">{line.description}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {line.outcome
                      ? `${labels[line.outcome]} (filled in when the ${line.autoFormTitle} form was signed)`
                      : `Fills in by itself when the ${line.autoFormTitle} form is signed.`}
                  </p>
                </li>
              );
            }
            if (line.lockedNote) {
              return (
                <li key={line.id} className="py-4">
                  <p className="text-sm font-medium text-slate-900">{line.description}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {line.outcome
                      ? `${labels[line.outcome]}${line.remarks ? ` · ${line.remarks}` : ""}`
                      : line.lockedNote}
                  </p>
                </li>
              );
            }
            const answer = draft.get(line.id)!;
            const error = lineErrors.get(line.id);
            return (
              <li key={line.id} className="flex flex-col gap-2 py-4">
                <p className="text-sm font-medium text-slate-900">{line.description}</p>
                <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={line.description}>
                  {OUTCOMES.map((o) => (
                    <label key={o} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`answer-${line.id}`}
                        checked={answer.outcome === o}
                        onChange={() => update(line.id, { outcome: o })}
                        disabled={busy}
                      />
                      {labels[o]}
                    </label>
                  ))}
                </div>
                <input
                  type="text"
                  value={answer.remarks}
                  onChange={(e) => update(line.id, { remarks: e.target.value })}
                  maxLength={500}
                  placeholder={answer.outcome === "No" ? "Remarks (required)" : "Remarks (optional)"}
                  aria-label={`Remarks: ${line.description}`}
                  className={inputClass}
                  disabled={busy}
                />
                {error && <p className="text-xs text-red-700">{error}</p>}
                {!error && justSaved.has(line.id) && (
                  <p className="text-xs text-green-700">Saved</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {editable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || changedIds.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save answers"}
          </button>
          {changedIds.length > 0 && !isSaving && (
            <span className="text-xs text-slate-500">
              {changedIds.length} unsaved change{changedIds.length === 1 ? "" : "s"}
            </span>
          )}
          {saveError && <p className="text-sm text-red-700">{saveError}</p>}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Sign this part</h3>
        <input
          type="text"
          value={signRemarks}
          onChange={(e) => setSignRemarks(e.target.value)}
          maxLength={500}
          placeholder="Remarks (optional)"
          aria-label="Signature remarks"
          className={inputClass}
          disabled={busy}
        />
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
            disabled={busy}
          />
          {CONFIRM_TEXT}
        </label>
        {signHint && <p className="text-xs text-amber-700">{signHint}</p>}
        {signBlockers.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-slate-500">
            {signBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div>
          <button
            type="button"
            onClick={handleSign}
            disabled={busy || !confirmed || signBlockers.length > 0}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigning ? "Signing…" : "Sign"}
          </button>
        </div>
        {signError && <p className="text-sm text-red-700">{signError}</p>}
      </div>
    </div>
  );
}
