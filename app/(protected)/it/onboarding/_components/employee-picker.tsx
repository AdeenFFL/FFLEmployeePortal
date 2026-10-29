"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EmployeeLookup, ItEmployeeCategory, ItLifecycleKind } from "@/types/database";
import { findEmployees } from "../actions";

// HR's offboarding / replacement form (javaria_it_0018): type a name or employee code, pick from
// the suggestions, and the employee's details show as a read-only card — nothing to re-type.
// Each field HR may know better than the record has a "Change" link. What's submitted:
//   personId                 — always
//   designation / siteId     — only when changed (empty = the database copies them from persons)
//   employeeCategory         — pre-set from persons.employment_type, changeable
//   lastWorkingDate          — Offboarding; pre-filled with the contract end date if there is one

type Site = { id: string; name: string };

const fmtDate = (d: string | null) =>
  d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "—";

function Row({
  label,
  value,
  onChange,
  editing,
  children,
}: {
  label: string;
  value: React.ReactNode;
  onChange?: () => void;
  editing?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
        {onChange && !editing && (
          <button
            type="button"
            onClick={onChange}
            className="text-[11px] font-medium normal-case tracking-normal text-blue-700 hover:underline"
          >
            Change
          </button>
        )}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">{editing ? children : value}</dd>
    </div>
  );
}

export function EmployeePicker({
  kind,
  sites,
  inputClass,
  labelClass,
}: {
  kind: ItLifecycleKind;
  sites: Site[];
  inputClass: string;
  labelClass: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeLookup[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<EmployeeLookup | null>(null);
  const [editDesignation, setEditDesignation] = useState(false);
  const [editSite, setEditSite] = useState(false);
  const [editCategory, setEditCategory] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // 300 ms after typing stops, ask the server (it.employee_lookup, access-checked there).
  useEffect(() => {
    const q = query.trim();
    if (picked || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await findEmployees(q);
        if (!cancelled) {
          setResults(rows);
          setActive(0);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, picked]);

  function pick(e: EmployeeLookup) {
    setPicked(e);
    setOpen(false);
    setEditDesignation(false);
    setEditSite(false);
    setEditCategory(!e.employee_category); // unknown category → HR must choose
  }

  function reset() {
    setPicked(null);
    setQuery("");
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  if (!picked) {
    const showList = open && query.trim().length >= 2;
    return (
      <div className="relative">
        <label className="block">
          <span className={labelClass}>
            Employee <span className="text-red-500">*</span>
          </span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 2) {
                setResults([]);
                setOpen(false);
              }
            }}
            onKeyDown={(e) => {
              if (!showList || results.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(results[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Start typing a name or employee code…"
            autoComplete="off"
            className={inputClass}
          />
        </label>
        {/* Keeps the form un-submittable until someone is picked. */}
        <input type="text" name="personId" required value="" onChange={() => {}} className="sr-only" tabIndex={-1} aria-hidden />
        <p className="mt-1 text-xs text-slate-400">
          {loading ? "Searching…" : "Pick the employee — their details fill in automatically."}
        </p>
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {results.length === 0 && !loading ? (
              <li className="px-3 py-2 text-sm text-slate-400">No employee matches “{query.trim()}”.</li>
            ) : (
              results.map((e, i) => (
                <li
                  key={e.person_id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    pick(e);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-blue-50" : ""}`}
                >
                  <span className="font-medium text-slate-900">{e.full_name}</span>
                  <span className="ml-2 text-slate-500">
                    {[e.employee_code, e.designation, e.site_name].filter(Boolean).join(" · ")}
                  </span>
                  {e.status !== "Active" && <span className="ml-2 text-xs text-amber-600">{e.status}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    );
  }

  const defaultLastDay = picked.employee_category === "Contractual" ? (picked.contract_end_date ?? "") : "";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="personId" value={picked.person_id} />
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-slate-900">{picked.full_name}</p>
          <p className="text-sm text-slate-500">
            {picked.employee_code ?? "No employee code"}
            {picked.status !== "Active" && <span className="ml-2 text-amber-700">· {picked.status}</span>}
          </p>
        </div>
        <button type="button" onClick={reset} className="text-sm font-medium text-blue-700 hover:underline">
          Pick someone else
        </button>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Row
          label="Designation"
          value={picked.designation ?? "—"}
          onChange={() => setEditDesignation(true)}
          editing={editDesignation}
        >
          <input
            name="designation"
            defaultValue={picked.designation ?? ""}
            aria-label="Designation"
            autoFocus
            className={inputClass}
          />
        </Row>
        <Row label="Company" value={picked.company_name ?? "—"} />
        <Row label="Location" value={picked.site_name ?? "—"} onChange={() => setEditSite(true)} editing={editSite}>
          <select name="siteId" defaultValue={picked.site_id ?? ""} aria-label="Location" className={inputClass}>
            <option value="">—</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="Employee category"
          value={picked.employee_category ?? "—"}
          onChange={() => setEditCategory(true)}
          editing={editCategory}
        >
          <select
            name="employeeCategory"
            defaultValue={picked.employee_category ?? ""}
            required={kind === "Offboarding"}
            aria-label="Employee category"
            className={inputClass}
          >
            <option value="">{kind === "Offboarding" ? "Choose…" : "—"}</option>
            <option value="Permanent">Permanent</option>
            <option value="Contractual">Contractual</option>
          </select>
        </Row>
        {!editCategory && <input type="hidden" name="employeeCategory" value={(picked.employee_category as ItEmployeeCategory) ?? ""} />}
        <Row label="Joining date" value={fmtDate(picked.date_of_joining)} />
        {picked.contract_end_date && <Row label="Contract ends" value={fmtDate(picked.contract_end_date)} />}
      </dl>

      {kind === "Offboarding" && (
        <label className="mt-4 block max-w-xs">
          <span className={labelClass}>
            Last working date <span className="text-red-500">*</span>
          </span>
          <input type="date" name="lastWorkingDate" required defaultValue={defaultLastDay} className={inputClass} />
          {defaultLastDay && <span className="mt-1 block text-xs text-slate-400">Pre-filled from the contract end date.</span>}
        </label>
      )}
    </div>
  );
}
