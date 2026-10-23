"use client";

import { useMemo, useState } from "react";

type Option = { id: string; label: string; search: string };

// Product select with a type-to-filter box (javaria_it_0013 improvement #8). The select still
// submits `productId`; the filter only narrows which options are listed.
export function ProductPicker({
  options,
  defaultValue,
  inputClass,
}: {
  options: Option[];
  defaultValue?: string;
  inputClass: string;
}) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const matches = options.filter((o) => o.search.includes(q));
    // Keep the current choice listed so filtering never silently clears it.
    const current = options.find((o) => o.id === value);
    return current && !matches.includes(current) ? [current, ...matches] : matches;
  }, [options, query, value]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${options.length} products by name or category…`}
        aria-label="Search products"
        className={inputClass}
      />
      <select
        name="productId"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        size={Math.min(8, Math.max(3, visible.length + 1))}
        className={inputClass}
      >
        <option value="" disabled>
          {visible.length === 0 ? "No product matches" : "Choose a product…"}
        </option>
        {visible.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
