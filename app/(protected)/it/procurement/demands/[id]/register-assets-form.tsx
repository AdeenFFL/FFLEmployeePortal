"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

// Receiving → assets (javaria_it_0021). One row per accepted, still-unregistered item: tag + serial.
// "Fill tags" numbers the tags from a prefix; serials can be pasted from the scanner, one per line.
// Rows left empty are skipped, so part of a delivery can be registered now and the rest later.
export function RegisterAssetsForm({
  action,
  remaining,
  productName,
  companies,
}: {
  action: (formData: FormData) => void;
  remaining: number;
  productName: string;
  companies: { id: string; name: string }[];
}) {
  const [tags, setTags] = useState<string[]>(() => Array(remaining).fill(""));
  const [serials, setSerials] = useState<string[]>(() => Array(remaining).fill(""));
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState(1);

  const fillTags = () => {
    if (!prefix.trim()) return;
    const width = Math.max(3, String(start + remaining - 1).length);
    setTags(tags.map((_, i) => `${prefix.trim()}${String(start + i).padStart(width, "0")}`));
  };
  const pasteSerials = (text: string, from: number) => {
    const lines = text.split(/[\r\n\t]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    setSerials(serials.map((s, i) => (i >= from && i - from < lines.length ? lines[i - from] : s)));
    return true;
  };
  const ready = tags.some((t, i) => t.trim() && serials[i].trim());

  return (
    <form action={action} className="mt-3 space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Tag prefix</span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="e.g. FFL-LAP-"
            className={`${fieldClass} w-36`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Start at</span>
          <input
            type="number"
            min={0}
            value={start}
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
            className={`${fieldClass} w-24`}
          />
        </label>
        <button
          type="button"
          onClick={fillTags}
          disabled={!prefix.trim()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Fill tags
        </button>
        <p className="basis-full text-xs text-slate-500">
          Tip: paste several serial numbers (one per line) into a serial box to fill the rows below it.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">#</th>
              <th className="px-3 py-2">Asset tag</th>
              <th className="px-3 py-2">Serial number</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tags.map((tag, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <input
                    name="assetTag"
                    value={tag}
                    onChange={(e) => setTags(tags.map((t, j) => (j === i ? e.target.value : t)))}
                    aria-label={`Asset tag ${i + 1}`}
                    className={fieldClass}
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    name="serialNumber"
                    value={serials[i]}
                    onChange={(e) => setSerials(serials.map((s, j) => (j === i ? e.target.value : s)))}
                    onPaste={(e) => {
                      if (pasteSerials(e.clipboardData.getData("text"), i)) e.preventDefault();
                    }}
                    aria-label={`Serial number ${i + 1}`}
                    className={fieldClass}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          Same for all items <span className="font-normal text-slate-400">(optional)</span>
        </summary>
        <div className="mt-3 grid gap-3 pb-1 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Manufacturer</span>
            <input name="manufacturer" placeholder="e.g. HP" className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Model</span>
            <input name="modelNumber" placeholder="e.g. ProBook 450 G10" className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Warranty until</span>
            <input type="date" name="warrantyExpiry" className={fieldClass} />
          </label>
        </div>
      </details>

      {companies.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Owning company</span>
          <select name="companyId" required defaultValue="" className={fieldClass}>
            <option value="" disabled>
              Choose…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Each becomes a <span className="font-medium text-slate-700">{productName}</span> asset, Unassigned, with
          vendor, site and purchase date from this delivery.
        </p>
        <Submit ready={ready} />
      </div>
    </form>
  );
}

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!ready || pending}
      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Registering…" : "Register assets"}
    </button>
  );
}
