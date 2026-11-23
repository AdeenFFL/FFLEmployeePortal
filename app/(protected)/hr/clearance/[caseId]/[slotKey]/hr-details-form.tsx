"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClearanceDetails, searchLineManagers } from "./actions";
import { LIVE_SEARCH_MIN, useLiveSearch } from "../../use-live-search";
import {
  HR_DETAIL_FIELDS,
  HR_DETAIL_GROUPS,
  type HrDetailField,
  type HrDetailsValues,
} from "../../hr-details-fields";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

// Live search of employees for a "person" field: pick someone (saved as "Name (code)"), or use the
// typed text as it is. The chosen value shows as a chip with ✕ to clear it.
function PersonField({
  id,
  value,
  onChange,
  disabled,
  maxLength,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  maxLength?: number;
}) {
  const [query, setQuery] = useState("");
  const { results, error, searching, tooShort } = useLiveSearch(
    query,
    searchLineManagers,
  );
  const typed = query.trim();

  function pick(text: string) {
    onChange(text.slice(0, maxLength ?? 200));
    setQuery("");
  }

  if (value.trim()) {
    return (
      <div
        id={id}
        className="flex w-fit max-w-full items-center gap-2 rounded-full bg-blue-50 py-1 pl-3 pr-1 text-sm text-blue-800"
      >
        <span className="truncate">{value}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear"
            title="Clear"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-blue-700 hover:bg-blue-100"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxLength={maxLength}
        disabled={disabled}
        placeholder="Type a name or employee code"
        className={inputClass}
      />
      {typed.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {tooShort && (
            <p className="px-2 py-1 text-xs text-slate-400">
              Type at least {LIVE_SEARCH_MIN} letters.
            </p>
          )}
          {searching && (
            <p className="px-2 py-1 text-xs text-slate-400">Searching…</p>
          )}
          {error && <p className="px-2 py-1 text-xs text-red-700">{error}</p>}
          {results && results.length > 0 && (
            <ul className="max-h-60 overflow-y-auto">
              {results.map((p) => (
                <li key={p.person_id}>
                  <button
                    type="button"
                    onClick={() =>
                      pick(
                        p.employee_code
                          ? `${p.full_name} (${p.employee_code})`
                          : p.full_name,
                      )
                    }
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-900">
                      {p.full_name}
                    </span>
                    <span className="text-xs text-slate-500">
                      {[p.employee_code, p.designation]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results && results.length === 0 && (
            <p className="px-2 py-1 text-xs text-slate-400">
              No active employee matches.
            </p>
          )}
          {/* Someone outside the list (or an email address): keep the typed text. */}
          <button
            type="button"
            onClick={() => pick(typed)}
            className="mt-1 w-full rounded-md border-t border-slate-100 px-2 py-1.5 text-left text-xs text-blue-700 hover:bg-slate-50"
          >
            Use “{typed}”
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [draft, setDraft] = useState<HrDetailsValues>({
    ...initial,
    ...prefill,
  });
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
          <p className="text-xs text-slate-500">
            Set it in the “Line manager” step.
          </p>
        </div>
      );
    }
    if (field.kind === "person") {
      return (
        <PersonField
          id={`hr-${field.key}`}
          value={draft[field.key]}
          onChange={(v) => update(field.key, v)}
          disabled={isSaving}
          maxLength={field.maxLength}
        />
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
        min={
          type === "number"
            ? 0
            : field.key === "last_working_date"
              ? dayAfter(draft.date_of_joining)
              : undefined
        }
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
          {/* An even grid: every field the same width, lined up in columns (3 on wide screens);
              the postal address takes a whole row. */}
          <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map((field) => (
              <div
                key={field.key}
                className={`flex min-w-0 flex-col gap-1 ${field.kind === "textarea" ? "sm:col-span-2 lg:col-span-3" : ""}`}
              >
                <label
                  htmlFor={`hr-${field.key}`}
                  className="text-sm font-medium text-slate-700"
                >
                  {field.label}
                  {field.unit && (
                    <span className="font-normal text-slate-500">
                      {" "}
                      ({field.unit})
                    </span>
                  )}
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
        {justSaved && changedCount === 0 && (
          <span className="text-xs text-green-700">Saved</span>
        )}
        {!justSaved && changedCount === 0 && (
          <span className="text-xs text-slate-500">
            {neverSaved ? "Not saved yet" : lastSaved}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
