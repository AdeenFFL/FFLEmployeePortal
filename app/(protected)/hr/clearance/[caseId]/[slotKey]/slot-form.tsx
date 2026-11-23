"use client";

import { useState, useTransition } from "react";
import { saveClearanceAnswer, signClearancePart } from "./actions";
import { LineAssign, type LineAssignee } from "./line-assign";
import { LineTag, RemarksButton } from "./remarks-button";
import { signedFlagKey } from "./signed-toast";

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
  // IT part only (talha_hr_0011): whom the lead handed this line to; undefined = not assignable.
  assignee?: LineAssignee | null;
};

const OUTCOMES: Outcome[] = ["Yes", "No", "N/A"];
const NEGATIVE_NEEDS_REMARK = "Please write a short remark for this answer.";
const CONFIRM_TEXT =
  "I confirm this part is complete. Your name and the time are recorded as your electronic signature.";

// One line = one row (wraps on a narrow screen), lit up on hover. The signed view in page.tsx
// uses the same look.
const rowHover = "-mx-2 rounded-lg px-2 py-2.5 hover:bg-slate-50";
const rowClass = `flex flex-wrap items-center gap-x-4 gap-y-2 ${rowHover}`;

// The segmented toggle: short marks, the form's own word on hover. The chosen one is filled.
const SEGMENT_TEXT: Record<Outcome, string> = {
  Yes: "✓",
  No: "✗",
  "N/A": "N/A",
};

// A line's text; a closing "(…)" (e.g. "(if any)", "(in case required)") goes under it as a
// small grey hint.
export function LineText({ description }: { description: string }) {
  const m = description.match(/^(.*\S)\s*\(([^()]+)\)\s*$/);
  const main = m ? m[1] : description;
  const hint = m ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : null;
  return (
    <div className="min-w-0 flex-1 basis-64">
      <p className="text-sm font-medium text-slate-900">{main}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

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
      editable.map((l) => [
        l.id,
        { outcome: l.outcome, remarks: l.remarks ?? "" },
      ]),
    );

  // `saved` is what the database holds; `draft` is what is on screen.
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map());
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  // The line whose Remarks popup is open (at most one).
  const [remarksOpenFor, setRemarksOpenFor] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const [confirmed, setConfirmed] = useState(false);
  const [signRemarks, setSignRemarks] = useState("");
  const [signError, setSignError] = useState<string | null>(null);
  const [isSigning, startSigning] = useTransition();

  const changedIds = editable
    .filter((l) => !sameAnswer(draft.get(l.id)!, saved.get(l.id)!))
    .map((l) => l.id);
  const unansweredCount = editable.filter(
    (l) => !saved.get(l.id)!.outcome,
  ).length;

  function update(lineId: string, patch: Partial<Answer>) {
    setDraft((prev) =>
      new Map(prev).set(lineId, { ...prev.get(lineId)!, ...patch }),
    );
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
          else if (answer.outcome === "No" && !answer.remarks.trim())
            error = NEGATIVE_NEEDS_REMARK;
          else {
            const result = await saveClearanceAnswer(
              caseId,
              lineId,
              answer.outcome,
              answer.remarks,
            );
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
    // The locked view shows a short "Signed ✓" pop-up once (signed-toast.tsx). The flag is set
    // BEFORE signing: the action's revalidation can swap in the locked view before the result
    // reaches this code. It is cleared again if signing fails.
    const flagKey = signedFlagKey(caseId, slotKey);
    const setFlag = (on: boolean) => {
      try {
        if (on) sessionStorage.setItem(flagKey, "1");
        else sessionStorage.removeItem(flagKey);
      } catch {
        // Storage blocked: no pop-up, the locked view still says it is signed.
      }
    };
    setFlag(true);
    startSigning(async () => {
      try {
        const result = await signClearancePart(caseId, slotKey, signRemarks);
        if (result.error) {
          setFlag(false);
          setSignError(result.error);
        }
        // On success the action revalidates this page, which then shows the locked view.
      } catch {
        setFlag(false);
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
    signBlockers.push(
      "Waiting for the line manager to confirm “Complete data received”.",
    );
  }
  if (signBlocker) signBlockers.push(signBlocker);
  if (changedIds.length > 0) signBlockers.push("Save your answers first.");
  const busy = isSaving || isSigning;

  // "No" answers on screen that still have no remark (the footer counts them).
  const noWithoutRemark = editable.filter((l) => {
    const a = draft.get(l.id)!;
    return a.outcome === "No" && !a.remarks.trim();
  }).length;

  // Lines I can answer that have no answer on screen yet ("Mark all" fills only these).
  const blankIds = editable.filter((l) => draft.get(l.id)!.outcome === null).map((l) => l.id);

  // On screen only (Save answers stores it); never overwrites an answer already chosen.
  function markAllYes() {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const id of blankIds) next.set(id, { ...prev.get(id)!, outcome: "Yes" });
      return next;
    });
    setJustSaved(new Set());
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {blankIds.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={markAllYes}
            disabled={busy}
            title="Fills only the lines without an answer; you can change any of them before saving."
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            ✓ Mark all {labels.Yes} ({blankIds.length})
          </button>
        </div>
      )}
      {lines.length === 0 ? (
        <p className="text-sm text-slate-600">
          This part has no checklist. Sign to confirm the employee&apos;s
          department clearance.
        </p>
      ) : (
        // One row per line: the text (and its hint) on the left; the answer (or a tag saying
        // where the process is waiting), Remarks and, on the IT part, Assign on the right.
        <ol className="flex flex-col divide-y divide-slate-100">
          {lines.map((line) => {
            if (line.auto || line.lockedNote) {
              const waitingTitle = line.auto
                ? `Fills in by itself when the ${line.autoFormTitle} form is signed.`
                : (line.lockedNote ?? undefined);
              return (
                <li key={line.id} className={rowClass}>
                  <LineText description={line.description} />
                  <div className="flex flex-wrap items-center gap-2">
                    {line.outcome ? (
                      <LineTag
                        tone={line.outcome === "No" ? "no" : "done"}
                        title={waitingTitle}
                      >
                        {line.outcome === "No"
                          ? labels.No
                          : `✓ ${labels[line.outcome]}`}
                      </LineTag>
                    ) : (
                      <LineTag tone="waiting" title={waitingTitle}>
                        {line.auto
                          ? `Waiting: ${line.autoFormTitle} sign-off`
                          : "Waiting: line manager"}
                      </LineTag>
                    )}
                    <RemarksButton
                      value={line.remarks ?? ""}
                      label={line.description}
                    />
                  </div>
                </li>
              );
            }
            const answer = draft.get(line.id)!;
            const error = lineErrors.get(line.id);
            return (
              <li key={line.id} className={`flex flex-col gap-1 ${rowHover}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <LineText description={line.description} />
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Segmented toggle: ✓ / ✗ / N/A; clicking the chosen one clears it. */}
                    <div
                      className="inline-flex overflow-hidden rounded-lg border border-slate-300"
                      role="radiogroup"
                      aria-label={line.description}
                    >
                      {OUTCOMES.map((o, i) => {
                        const selected = answer.outcome === o;
                        return (
                          <button
                            key={o}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={labels[o]}
                            title={labels[o]}
                            disabled={busy}
                            onClick={() => {
                              update(line.id, {
                                outcome: selected ? null : o,
                              });
                              // "No" needs a remark: open the box straight away.
                              if (
                                !selected &&
                                o === "No" &&
                                !answer.remarks.trim()
                              )
                                setRemarksOpenFor(line.id);
                            }}
                            className={`min-w-10 px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                              i > 0 ? "border-l border-slate-300" : ""
                            } ${selected ? "bg-blue-100 text-blue-800" : "bg-white text-slate-400 hover:bg-slate-50"}`}
                          >
                            {SEGMENT_TEXT[o]}
                          </button>
                        );
                      })}
                    </div>
                    <RemarksButton
                      value={answer.remarks}
                      onChange={(v) => update(line.id, { remarks: v })}
                      label={line.description}
                      required={answer.outcome === "No"}
                      disabled={busy}
                      open={remarksOpenFor === line.id}
                      onOpenChange={(o) =>
                        setRemarksOpenFor(o ? line.id : null)
                      }
                    />
                    {line.assignee !== undefined && (
                      <LineAssign
                        caseId={caseId}
                        target={{ kind: "line", lineId: line.id }}
                        assignee={line.assignee}
                        disabled={busy}
                        label={line.description}
                        compact
                      />
                    )}
                  </div>
                </div>
                {error && <p className="text-xs text-red-700">{error}</p>}
                {!error && justSaved.has(line.id) && (
                  <p className="text-xs text-green-700">Saved</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Save: only while something on screen is not saved yet (outlined, text only). It sticks
          to the bottom of the screen, so it stays in reach on a long checklist. */}
      {editable.length > 0 &&
        (noWithoutRemark > 0 ||
          changedIds.length > 0 ||
          isSaving ||
          saveError) && (
          <div className="sticky bottom-0 z-10 -mx-5 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
            {noWithoutRemark > 0 && (
              <p className="w-full text-xs font-medium text-red-700">
                {noWithoutRemark} “{labels.No}” answer
                {noWithoutRemark === 1 ? " needs" : "s need"} a remark.
              </p>
            )}
            {(changedIds.length > 0 || isSaving) && (
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="rounded-md border border-blue-300 bg-white px-4 py-1.5 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save answers"}
              </button>
            )}
            {changedIds.length > 0 && !isSaving && (
              <span className="text-xs text-slate-500">
                {changedIds.length} unsaved change
                {changedIds.length === 1 ? "" : "s"}
              </span>
            )}
            {saveError && <p className="text-sm text-red-700">{saveError}</p>}
          </div>
        )}

      {/* Sign: the tick box, any blockers, then Sign and its remark (💬). */}
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSign}
            disabled={busy || !confirmed || signBlockers.length > 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 shadow-sm enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.8a1 1 0 0 1 1.4 0Z"
              />
            </svg>
            {isSigning ? "Signing…" : "Sign this part"}
          </button>
          <RemarksButton
            value={signRemarks}
            onChange={setSignRemarks}
            label="Signature remarks"
            disabled={busy}
          />
        </div>
        {signError && <p className="text-sm text-red-700">{signError}</p>}
      </div>
    </div>
  );
}
