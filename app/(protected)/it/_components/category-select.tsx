"use client";

import { useState } from "react";
import { inputClass, labelClass } from "./ticket-ui";

type Category = { id: string; name: string; parent_id: string | null };

// Category + dependent subcategory pair, submitted as categoryId / subcategoryId.
export function CategorySelect({
  categories,
  defaultCategoryId,
  defaultSubcategoryId,
}: {
  categories: Category[];
  defaultCategoryId: string | null;
  defaultSubcategoryId: string | null;
}) {
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const subcategories = categories.filter((c) => c.parent_id === categoryId);

  return (
    <>
      <div>
        <label htmlFor="triage-category" className={labelClass}>
          Category
        </label>
        <select
          id="triage-category"
          name="categoryId"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">—</option>
          {categories
            .filter((c) => !c.parent_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label htmlFor="triage-subcategory" className={labelClass}>
          Subcategory
        </label>
        <select
          id="triage-subcategory"
          name="subcategoryId"
          key={categoryId}
          defaultValue={categoryId === defaultCategoryId ? (defaultSubcategoryId ?? "") : ""}
          disabled={subcategories.length === 0}
          className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
        >
          <option value="">—</option>
          {subcategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
