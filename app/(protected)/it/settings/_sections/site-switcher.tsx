"use client";

import { useRouter } from "next/navigation";

// Picking a site shows it straight away (no "Show" button). The rest of the address (tab,
// section) is kept.
export function SiteSwitcher({
  sites,
  siteId,
  baseQuery,
}: {
  sites: { id: string; name: string }[];
  siteId: string | undefined;
  baseQuery: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-500">
      <span>Site</span>
      <select
        value={siteId}
        onChange={(e) => router.push(`/it/settings?${baseQuery}&site=${e.target.value}`)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
