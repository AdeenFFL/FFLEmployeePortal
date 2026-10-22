"use client";

import { useEffect, useState } from "react";
import { inputClass, labelClass, primaryButtonClass } from "../../_components/ticket-ui";
import { assignAssetForOnboardingTask, searchUnassignedAssets } from "../actions";

type AssetOption = { asset_id: string; asset_tag: string; asset_name: string; serial_number: string };

function describe(a: AssetOption) {
  return `${a.asset_tag} — ${a.asset_name} (SN ${a.serial_number})`;
}

// The Asset Allocation checklist task's real-world counterpart to asset-assign-form.tsx (IT
// module revision, Phase 3). That form is asset-first (you're on a known asset, pick who gets
// it); here the person is already known (the new joiner) and the asset is unknown, so this
// searches unassigned assets instead of people.
export function AssetAllocationForm({
  requestId,
  itemId,
}: {
  requestId: string;
  itemId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetOption[]>([]);
  const [selected, setSelected] = useState<AssetOption | null>(null);
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
        const assets = await searchUnassignedAssets(term);
        if (!cancelled) {
          setResults(assets);
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

  return (
    <form action={assignAssetForOnboardingTask.bind(null, requestId, itemId)} className="space-y-3">
      <div>
        <label className={labelClass}>Asset *</label>
        {selected ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-900">{describe(selected)}</span>
            <input type="hidden" name="asset_id" value={selected.asset_id} />
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
        ) : (
          <div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type 2+ letters of a tag, serial or name"
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
                  <p className="px-3 py-2 text-slate-400">No unassigned asset matches “{term}”.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {results.map((a) => (
                      <li key={a.asset_id}>
                        <button
                          type="button"
                          onClick={() => setSelected(a)}
                          className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-900">{a.asset_tag}</span>{" "}
                          <span className="text-slate-700">{a.asset_name}</span>
                          <span className="block text-xs text-slate-500">SN {a.serial_number}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>Condition at handover</label>
        <input name="condition" placeholder="e.g. New, Good" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Remarks</label>
        <input name="remarks" placeholder="Optional" className={inputClass} />
      </div>
      <button type="submit" disabled={!selected} className={`${primaryButtonClass} disabled:opacity-60`}>
        Assign asset
      </button>
    </form>
  );
}
