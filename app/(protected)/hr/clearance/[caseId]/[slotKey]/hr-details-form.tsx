"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClearanceDetails } from "./actions";
import {
  HR_DETAIL_FIELDS,
  HR_DETAIL_GROUPS,
  type HrDetailField,
  type HrDetailsValues,
} from "../../hr-details-fields";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// "2024-03-31" → "2024-04-01", so the Last working date calendar starts after the joining date.
// Returns undefined for an empty or invalid date.
function dayAfter(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// The HR signer's page-one details: one form, ONE "Save details" button. The database function
// overwrites every field at once, so the whole form is always sent. Errors stay inline.
export function HrDetailsForm({
  caseId,
  initial,
  prefill,
  prefillNote,
  lastSaved,
}: {
  caseId: string;
  initial: HrDetailsValues;
  // Suggested values (e.g. the joining date from onboarding): they start in the form as unsaved
  // changes, so "Save details" stores them.
  prefill?: Partial<HrDetailsValues>;
  // Shown under a prefilled field while it still holds the suggested value.
  prefillNote?: string;
  // "Last saved …" text worked out on the server, or null when never saved.
  lastSaved: string | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<HrDetailsValues>({ ...initial, ...prefill });
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const changedCount = HR_DETAIL_FIELDS.filter(
    (f) => draft[f.key].trim() !== saved[f.key].trim(),
  ).length;
  // Never saved: allow saving the prefilled values as they are.
  const neverSaved = lastSaved === null && !savedOnce;

  function update(key: HrDetailField["key"], value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setJustSaved(false);
  }

  function handleSave() {
    setError(null);
    setJustSaved(false);
    const values = draft;
    startSaving(async () => {
      try {
        const result = await saveClearanceDetails(caseId, values);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved(values);
        setSavedOnce(true);
        setJustSaved(true);
        // Re-read the page: saving can lock the line manager and clears the Sign hint.
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  function renderInput(field: HrDetailField) {
    // Read from the prop, not the draft: it changes when the picker below saves a new manager.
    if (field.fromPicker) {
      return (
        <div id={`hr-${field.key}`}>
          <p className="text-sm text-slate-900">{initial[field.key] || "—"}</p>
          <p className="text-xs text-slate-500">Set it with “Line manager” above.</p>
        </div>
      );
    }
    const common = {
      id: `hr-${field.key}`,
      value: draft[field.key],
      disabled: isSaving,
      className: inputClass,
    };
    if (field.kind === "textarea") {
      return (
        <textarea
          {...common}
          rows={2}
          maxLength={field.maxLength}
          onChange={(e) => update(field.key, e.target.value)}
        />
      );
    }
    const type =
      field.kind === "whole" || field.kind === "decimal"
        ? "number"
        : field.kind === "email"
          ? "email"
          : field.kind === "date"
            ? "date"
            : "text";
    return (
      <input
        {...common}
        type={type}
        required={field.required}
        maxLength={field.maxLength}
        min={type === "number" ? 0 : field.key === "last_working_date" ? dayAfter(draft.date_of_joining) : undefined}
        max={field.kind === "whole" ? 365 : undefined}
        step={field.kind === "whole" ? 1 : field.step}
        inputMode={field.kind === "decimal" ? "decimal" : undefined}
        onChange={(e) => update(field.key, e.target.value)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {HR_DETAIL_GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {group.title}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => (
              <div
                key={field.key}
                className={field.kind === "textarea" ? "flex flex-col gap-1 sm:col-span-2" : "flex flex-col gap-1"}
              >
                <label htmlFor={`hr-${field.key}`} className="text-sm font-medium text-slate-700">
                  {field.label}
                  {field.unit && <span className="font-normal text-slate-500"> ({field.unit})</span>}
                  {field.required && <span className="text-red-600"> *</span>}
                </label>
                {renderInput(field)}
                {prefillNote &&
                  prefill?.[field.key] !== undefined &&
                  draft[field.key] === prefill[field.key] &&
                  draft[field.key] !== saved[field.key] && (
                    <p className="text-xs text-blue-700">{prefillNote}</p>
                  )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || (changedCount === 0 && !neverSaved)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save details"}
        </button>
        {changedCount > 0 && !isSaving && (
          <span className="text-xs text-slate-500">
            {changedCount} unsaved change{changedCount === 1 ? "" : "s"}
          </span>
        )}
        {justSaved && changedCount === 0 && <span className="text-xs text-green-700">Saved</span>}
        {!justSaved && changedCount === 0 && (
          <span className="text-xs text-slate-500">{neverSaved ? "Not saved yet" : lastSaved}</span>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
