"use client";

import { useEffect, useState } from "react";
import { searchPeople, type PersonOption } from "../actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500";

function describe(p: PersonOption) {
  const extra = [p.designation, p.employee_code].filter(Boolean).join(" · ");
  return extra ? `${p.full_name} — ${extra}` : p.full_name;
}

// Employee picker for the Assign panel. Searches as you type (2+ letters, after a short pause)
// through the searchPeople Server Action, and submits the chosen person's id as `name`.
export function PersonPicker({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOption[]>([]);
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  const term = query.trim();
  const active = !selected && term.length >= 2;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const people = await searchPeople(term);
        if (!cancelled) {
          setResults(people);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, term]);

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-900">{describe(selected)}</span>
        <input type="hidden" name={name} value={selected.person_id} />
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setResults([]);
          }}
          className="shrink-0 text-xs text-blue-600 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type 2+ letters of a name or employee code"
        autoComplete="off"
        className={inputClass}
      />
      {active && (
        <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-sm">
          {searching && results.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">Searching…</p>
          ) : failed ? (
            <p className="px-3 py-2 text-red-600">Search failed. Please try again.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-slate-400">No active employees match “{term}”.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((p) => (
                <li key={p.person_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="text-slate-900">{p.full_name}</span>
                    {(p.designation || p.employee_code) && (
                      <span className="block text-xs text-slate-500">
                        {[p.designation, p.employee_code].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
