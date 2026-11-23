"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { forwardCase } from "./actions";

export const BULK_FORM_ID = "bulk-forward";

// The bar above the "To forward" list: the tick boxes in the table belong to this form (their
// form="bulk-forward"), so the table itself stays server-rendered. "Forward selected" forwards
// them one by one with the same action as the single Forward button (parts with no signer are
// still skipped by themselves), then shows what worked and what did not. Failed ones stay ticked.
export function BulkForwardBar({
  caseNumbers,
}: {
  caseNumbers: Record<string, string>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<{ ok: number; failed: string[] } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function boxes() {
    const form = formRef.current;
    if (!form) return [];
    return Array.from(form.elements).filter(
      (el): el is HTMLInputElement =>
        el instanceof HTMLInputElement && el.name === "ids",
    );
  }
  function recount() {
    setSelected(boxes().filter((b) => b.checked).length);
  }

  // The boxes live in the table, not inside the form element, so listen on the page.
  useEffect(() => {
    function onChange(e: Event) {
      const t = e.target;
      if (
        t instanceof HTMLInputElement &&
        t.name === "ids" &&
        t.form === formRef.current
      ) {
        setSelected(
          Array.from(formRef.current?.elements ?? []).filter(
            (el) =>
              el instanceof HTMLInputElement && el.name === "ids" && el.checked,
          ).length,
        );
      }
    }
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);

  function selectAll(on: boolean) {
    for (const b of boxes()) b.checked = on;
    recount();
  }

  function forwardSelected() {
    const ids = boxes()
      .filter((b) => b.checked)
      .map((b) => b.value);
    if (ids.length === 0) return;
    setResult(null);
    startTransition(async () => {
      let ok = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const r = await forwardCase(id);
          if (r.error)
            failed.push(`${caseNumbers[id] ?? "Request"}: ${r.error}`);
          else {
            ok++;
            const box = boxes().find((b) => b.value === id);
            if (box) box.checked = false;
          }
        } catch {
          failed.push(`${caseNumbers[id] ?? "Request"}: Something went wrong.`);
        }
      }
      setResult({ ok, failed });
      recount();
      router.refresh();
    });
  }

  return (
    <form
      id={BULK_FORM_ID}
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        forwardSelected();
      }}
      className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => selectAll(true)}
          disabled={isPending}
          className="text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          Select all
        </button>
        {selected > 0 && (
          <button
            type="button"
            onClick={() => selectAll(false)}
            disabled={isPending}
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-slate-500">{selected} selected</span>
        <button
          type="submit"
          disabled={isPending || selected === 0}
          className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Forwarding…" : `Forward selected (${selected})`}
        </button>
      </div>
      {result && (
        <div className="text-xs">
          {result.ok > 0 && (
            <p className="text-green-700">{result.ok} forwarded.</p>
          )}
          {result.failed.map((f) => (
            <p key={f} className="text-red-700">
              {f}
            </p>
          ))}
        </div>
      )}
    </form>
  );
}
