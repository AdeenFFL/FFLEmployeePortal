"use client";

import { useMemo, useState } from "react";

type Option = { id: string; label: string; search: string; suggestedCategory: string };
type Category = { value: string; label: string; hint: string };

// Product select with a type-to-filter box (javaria_it_0013 #8) and the demand category
// (javaria_it_0017, BRD §5.5.2 "mandatory dropdown tied to the Product Master"): picking a product
// suggests its category until the user chooses one themselves. Both submit as plain form fields.
export function ProductPicker({
  options,
  categories,
  defaultValue,
  inputClass,
  labelClass,
}: {
  options: Option[];
  categories: Category[];
  defaultValue?: string;
  inputClass: string;
  labelClass: string;
}) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");
  const [category, setCategory] = useState(
    options.find((o) => o.id === defaultValue)?.suggestedCategory ?? "",
  );
  const [categoryTouched, setCategoryTouched] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const matches = options.filter((o) => o.search.includes(q));
    // Keep the current choice listed so filtering never silently clears it.
    const current = options.find((o) => o.id === value);
    return current && !matches.includes(current) ? [current, ...matches] : matches;
  }, [options, query, value]);

  const hint = categories.find((c) => c.value === category)?.hint;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className={labelClass}>
          Product <span className="text-red-500">*</span>
        </span>
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
          aria-label="Product"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (!categoryTouched) {
              setCategory(options.find((o) => o.id === e.target.value)?.suggestedCategory ?? "");
            }
          }}
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
        <span className="block text-xs text-slate-400">
          Not in the list? Ask procurement to add it to the Product Master.
        </span>
      </div>

      <label className="block">
        <span className={labelClass}>
          Category <span className="text-red-500">*</span>
        </span>
        <select
          name="category"
          required
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setCategoryTouched(true);
          }}
          className={inputClass}
        >
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-400">
          {hint ?? "Consumables are issued from stock; everything else goes to the department head for approval."}
        </span>
      </label>
    </div>
  );
}
